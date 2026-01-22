import { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTabs } from './hooks/useTabs';
import { useSelection } from './hooks/useSelection';
import { useHighlightedTabs } from './hooks/useHighlightedTabs';
import { useHistory } from './hooks/useHistory';
import { useCloseTabsSetting } from './hooks/useCloseTabsSetting';
import { DomainGroup } from './components/DomainGroup';
import { Footer } from './components/Footer';
import { ExtractionErrorAlert } from './components/ExtractionErrorAlert';
import { ExportModal } from './components/ExportModal';
import { HistoryPanel } from './components/HistoryPanel';
import { getPageHTML } from './utils/scripting';
import { isYouTubeUrl } from './utils/youtube';
import { fetchYoutubeSubtitles } from './utils/subtitles';
import { getCachedContent, setCachedContent } from './utils/cache';
import { getTabsToRight, closeTabsSafely } from './utils/tabHelpers';
import { formatExport, generateFilename, getMimeType, downloadAsFile } from './utils/exporters';
import { withTimeout } from './utils/asyncHelpers';
import type { ExtractedData, ExtractionResult, ExtractionErrorInfo, ExtractionStatus, ExportFormat } from './types';
import { SubtitleError } from './types';

const EXTRACTION_TIMEOUT_MS = 10000; // 10 seconds

// Helper function to extract a single tab
async function extractTab(
  id: number
): Promise<{ result: ExtractedData | null; error: ExtractionErrorInfo | null }> {
  let tab: chrome.tabs.Tab | null = null;
  try {
    tab = await chrome.tabs.get(id);
    if (!tab.url) {
      console.warn(`Tab ${id}: No URL found`);
      return { result: null, error: null };
    }

    const tabUrl = tab.url;

    if (isYouTubeUrl(tabUrl)) {
      try {
        const { title, text } = await fetchYoutubeSubtitles(tabUrl, {
          onRetry: (attempt, err) => {
            console.warn(`Retry ${attempt} for ${tabUrl}:`, err.message);
          },
        });
        return {
          result: {
            id,
            timestamp: new Date().toISOString(),
            title,
            url: tabUrl,
            text,
          },
          error: null,
        };
      } catch (err) {
        const errorInfo = createExtractionError(id, tab, err);
        console.error(`Failed to extract YouTube subtitles for tab ${id}:`, err);
        return { result: null, error: errorInfo };
      }
    }

    const cachedContent = await getCachedContent(id);
    if (cachedContent) {
      return {
        result: {
          id,
          timestamp: new Date().toISOString(),
          title: cachedContent.title,
          url: cachedContent.url,
          text: cachedContent.text,
        },
        error: null,
      };
    }

    const injection = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: getPageHTML,
    });

    const result = injection[0]?.result as ExtractionResult | undefined;

    if (!result) {
      console.warn(`Tab ${id}: No content extracted (tab may be suspended or not loaded)`);
      return { result: null, error: null };
    }

    await setCachedContent(id, { text: result.text, title: result.title, url: result.url });

    return {
      result: {
        id,
        timestamp: new Date().toISOString(),
        title: result.title,
        url: result.url,
        text: result.text,
      },
      error: null,
    };
  } catch (err) {
    const errorInfo = createExtractionError(id, tab, err);
    console.error(`Failed to extract tab ${id}:`, err);
    return { result: null, error: errorInfo };
  }
}

// Helper function to create extraction error
function createExtractionError(id: number, tab: chrome.tabs.Tab | null, err: unknown): ExtractionErrorInfo {
  let code: SubtitleError['code'] = 'NETWORK_ERROR';
  let userMessage = 'Extraction failed';

  if (err instanceof SubtitleError) {
    code = err.code;
    userMessage = err.message;
  }

  return {
    tabId: id,
    url: tab?.url || 'unknown',
    title: tab?.title || 'Unknown',
    errorCode: code,
    userMessage,
  };
}

// Helper to extract tabs with timeout and partial results preservation
async function extractTabsWithTimeout(
  tabIds: number[],
  timeoutMs: number
): Promise<{ results: ExtractedData[]; errors: ExtractionErrorInfo[]; timedOut: boolean }> {
  const startTime = Date.now();
  const results: ExtractedData[] = [];
  const errors: ExtractionErrorInfo[] = [];
  const pendingExtractions = new Map<number, Promise<{ result: ExtractedData | null; error: ExtractionErrorInfo | null }>>();

  // Start all extractions
  for (const id of tabIds) {
    pendingExtractions.set(id, extractTab(id));
  }

  // Wait for results with timeout
  while (pendingExtractions.size > 0 && Date.now() - startTime < timeoutMs) {
    const remainingTime = timeoutMs - (Date.now() - startTime);
    if (remainingTime <= 0) break;

    // Race between the next extraction and the timeout
    try {
      const [nextId, nextPromise] = Array.from(pendingExtractions.entries())[0];
      const { result, error } = await withTimeout(nextPromise, remainingTime);

      if (error) {
        errors.push(error);
      } else if (result) {
        results.push(result);
      }
      pendingExtractions.delete(nextId);
    } catch {
      // Timeout occurred for this specific extraction
      break;
    }
  }

  const timedOut = pendingExtractions.size > 0;
  return { results, errors, timedOut };
}

export function SidePanelApp() {
  const { groups, isLoading, error, refresh } = useTabs();
  const {
    selectedCount,
    getSelectedIdsAsArray,
    isTabSelected,
    getDomainSelectionState,
    toggleTab,
    toggleDomain,
    clearSelection,
  } = useSelection();
  const { highlightedCount, highlightedTabs } = useHighlightedTabs();
  const history = useHistory();
  const { closeTabsEnabled, toggleCloseTabs } = useCloseTabsSetting();

  const [isExtracting, setIsExtracting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>('idle');
  const [extractionErrors, setExtractionErrors] = useState<ExtractionErrorInfo[]>([]);

  // Tabs to right state
  const [tabsToRightCount, setTabsToRightCount] = useState(0);
  const [isExtractingToRight, setIsExtractingToRight] = useState(false);
  const [toRightExtractionStatus, setToRightExtractionStatus] = useState<ExtractionStatus>('idle');
  const [toRightExtractionErrors, setToRightExtractionErrors] = useState<ExtractionErrorInfo[]>([]);

  // Highlighted tabs state
  const [isExtractingHighlighted, setIsExtractingHighlighted] = useState(false);
  const [highlightedExtractionStatus, setHighlightedExtractionStatus] = useState<ExtractionStatus>('idle');
  const [highlightedExtractionErrors, setHighlightedExtractionErrors] = useState<ExtractionErrorInfo[]>([]);

  // Export & History state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [lastExtractedData, setLastExtractedData] = useState<ExtractedData[]>([]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    clearSelection();
    await refresh();
    setIsRefreshing(false);
  }, [refresh, clearSelection]);

  // Effect to track tabs to right count
  useEffect(() => {
    const updateTabsToRightCount = async () => {
      const tabs = await getTabsToRight();
      setTabsToRightCount(tabs.length);
    };

    updateTabsToRightCount();

    // Recalculate on tab changes
    const handleTabChange = () => {
      updateTabsToRightCount();
    };

    chrome.tabs.onMoved.addListener(handleTabChange);
    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabs.onCreated.addListener(handleTabChange);
    chrome.tabs.onRemoved.addListener(handleTabChange);

    return () => {
      chrome.tabs.onMoved.removeListener(handleTabChange);
      chrome.tabs.onActivated.removeListener(handleTabChange);
      chrome.tabs.onCreated.removeListener(handleTabChange);
      chrome.tabs.onRemoved.removeListener(handleTabChange);
    };
  }, []);

  const handleExtract = useCallback(async () => {
    const selectedIds = getSelectedIdsAsArray();
    if (selectedIds.length === 0) return;

    setIsExtracting(true);
    setExtractionStatus('extracting');
    setExtractionErrors([]);
    toast.loading('Extracting content...', { id: 'extract-status' });

    try {
      const { results, errors, timedOut } = await extractTabsWithTimeout(selectedIds, EXTRACTION_TIMEOUT_MS);

      setExtractionErrors(errors);

      const validResults = results;
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      // Save to history
      if (validResults.length > 0) {
        await history.addEntry(validResults, 'json', 'clipboard');
        setLastExtractedData(validResults);

        // Close tabs if setting is enabled
        if (closeTabsEnabled) {
          const { closed } = await closeTabsSafely(validResults.map((r) => r.id));
          // Update selection state after closing
          if (closed > 0) {
            clearSelection();
          }
        }
      }

      toast.dismiss('extract-status');

      if (timedOut) {
        setExtractionStatus(validResults.length > 0 ? 'partial' : 'error');
        if (validResults.length > 0) {
          toast(`Extraction timed out after 10s. Extracted ${validResults.length} of ${selectedIds.length} tabs.`, {
            icon: '⚠️',
            duration: 5000,
          });
        } else {
          toast.error('Extraction timed out. Some tabs may be unresponsive.');
        }
      } else if (errors.length > 0 && validResults.length === 0) {
        setExtractionStatus('error');
        toast.error(`Extraction failed for all ${selectedIds.length} tab${selectedIds.length > 1 ? 's' : ''}`);
      } else if (errors.length > 0) {
        setExtractionStatus('partial');
        toast(`Extracted ${validResults.length} tab${validResults.length > 1 ? 's' : ''}, ${errors.length} failed`, {
          icon: '⚠️',
        });
      } else {
        setExtractionStatus('success');
        toast.success(`Extracted content from ${validResults.length} tab${validResults.length > 1 ? 's' : ''} and copied to clipboard`);
        setTimeout(() => {
          setExtractionStatus('idle');
        }, 2000);
      }
    } catch (err) {
      console.error('Extraction failed:', err);
      setExtractionStatus('error');
      toast.error('Content extraction failed. Please try again.');
    } finally {
      setIsExtracting(false);
    }
  }, [getSelectedIdsAsArray, history, closeTabsEnabled, clearSelection]);

  const handleExtractToRight = useCallback(async () => {
    const tabsToRight = await getTabsToRight();
    const tabIds = tabsToRight.map((t) => t.id);

    if (tabIds.length === 0) return;

    setIsExtractingToRight(true);
    setToRightExtractionStatus('extracting');
    setToRightExtractionErrors([]);
    toast.loading('Extracting content from tabs to the right...', { id: 'extract-to-right-status' });

    try {
      const { results, errors, timedOut } = await extractTabsWithTimeout(tabIds, EXTRACTION_TIMEOUT_MS);

      setToRightExtractionErrors(errors);

      const validResults = results;
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      // Save to history
      if (validResults.length > 0) {
        await history.addEntry(validResults, 'json', 'clipboard');
        setLastExtractedData(validResults);

        // Close tabs if setting is enabled
        if (closeTabsEnabled) {
          const { closed } = await closeTabsSafely(validResults.map((r) => r.id));
          // Update selection state after closing
          if (closed > 0) {
            clearSelection();
          }
        }
      }

      toast.dismiss('extract-to-right-status');

      if (timedOut) {
        setToRightExtractionStatus(validResults.length > 0 ? 'partial' : 'error');
        if (validResults.length > 0) {
          toast(`Extraction timed out after 10s. Extracted ${validResults.length} of ${tabIds.length} tabs.`, {
            icon: '⚠️',
            duration: 5000,
          });
        } else {
          toast.error('Extraction timed out. Some tabs may be unresponsive.');
        }
      } else if (errors.length > 0 && validResults.length === 0) {
        setToRightExtractionStatus('error');
        toast.error(`Extraction failed for all ${tabIds.length} tab${tabIds.length > 1 ? 's' : ''}`);
      } else if (errors.length > 0) {
        setToRightExtractionStatus('partial');
        toast(`Extracted ${validResults.length} tab${validResults.length > 1 ? 's' : ''}, ${errors.length} failed`, {
          icon: '⚠️',
        });
      } else {
        setToRightExtractionStatus('success');
        toast.success(`Extracted content from ${validResults.length} tab${validResults.length > 1 ? 's' : ''} and copied to clipboard`);
        setTimeout(() => {
          setToRightExtractionStatus('idle');
        }, 2000);
      }
    } catch (err) {
      console.error('Extraction failed:', err);
      setToRightExtractionStatus('error');
      toast.error('Content extraction failed. Please try again.');
    } finally {
      setIsExtractingToRight(false);
    }
  }, [history, closeTabsEnabled, clearSelection]);

  const handleExtractHighlighted = useCallback(async () => {
    const tabIds = highlightedTabs.map((t) => t.id);

    if (tabIds.length === 0) return;

    setIsExtractingHighlighted(true);
    setHighlightedExtractionStatus('extracting');
    setHighlightedExtractionErrors([]);
    toast.loading('Extracting content from highlighted tabs...', { id: 'extract-highlighted-status' });

    try {
      const { results, errors, timedOut } = await extractTabsWithTimeout(tabIds, EXTRACTION_TIMEOUT_MS);

      setHighlightedExtractionErrors(errors);

      const validResults = results;
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      // Save to history
      if (validResults.length > 0) {
        await history.addEntry(validResults, 'json', 'clipboard');
        setLastExtractedData(validResults);

        // Close tabs if setting is enabled
        if (closeTabsEnabled) {
          const { closed } = await closeTabsSafely(validResults.map((r) => r.id));
          // Update selection state after closing
          if (closed > 0) {
            clearSelection();
          }
        }
      }

      toast.dismiss('extract-highlighted-status');

      if (timedOut) {
        setHighlightedExtractionStatus(validResults.length > 0 ? 'partial' : 'error');
        if (validResults.length > 0) {
          toast(`Extraction timed out after 10s. Extracted ${validResults.length} of ${tabIds.length} tabs.`, {
            icon: '⚠️',
            duration: 5000,
          });
        } else {
          toast.error('Extraction timed out. Some tabs may be unresponsive.');
        }
      } else if (errors.length > 0 && validResults.length === 0) {
        setHighlightedExtractionStatus('error');
        toast.error(`Extraction failed for all ${tabIds.length} tab${tabIds.length > 1 ? 's' : ''}`);
      } else if (errors.length > 0) {
        setHighlightedExtractionStatus('partial');
        toast(`Extracted ${validResults.length} tab${validResults.length > 1 ? 's' : ''}, ${errors.length} failed`, {
          icon: '⚠️',
        });
      } else {
        setHighlightedExtractionStatus('success');
        toast.success(`Extracted content from ${validResults.length} tab${validResults.length > 1 ? 's' : ''} and copied to clipboard`);
        setTimeout(() => {
          setHighlightedExtractionStatus('idle');
        }, 2000);
      }
    } catch (err) {
      console.error('Extraction failed:', err);
      setHighlightedExtractionStatus('error');
      toast.error('Content extraction failed. Please try again.');
    } finally {
      setIsExtractingHighlighted(false);
    }
  }, [highlightedTabs, history, closeTabsEnabled, clearSelection]);

  // Export & History handlers
  const handleOpenExportModal = useCallback(() => {
    setIsExportModalOpen(true);
  }, []);

  const handleCloseExportModal = useCallback(() => {
    setIsExportModalOpen(false);
  }, []);

  const handleExportFromModal = useCallback(async (
    data: ExtractedData[],
    format: ExportFormat,
    action: 'clipboard' | 'file',
    filename?: string
  ) => {
    try {
      const formatted = formatExport(data, format);

      if (action === 'clipboard') {
        await navigator.clipboard.writeText(formatted);
        toast.success(`Exported as ${format.toUpperCase()} and copied to clipboard`);
      } else {
        const mimeType = getMimeType(format);
        const finalFilename = filename || generateFilename(format);
        downloadAsFile(formatted, finalFilename, mimeType);
        toast.success(`Downloaded as ${finalFilename}`);
      }

      // Save to history
      await history.addEntry(data, format, action, filename);
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Export failed. Please try again.');
    }
  }, [history]);

  const handleOpenHistory = useCallback(() => {
    setIsHistoryPanelOpen(true);
  }, []);

  const handleCloseHistory = useCallback(() => {
    setIsHistoryPanelOpen(false);
  }, []);

  const handleReExport = useCallback(async (
    data: ExtractedData[],
    format: ExportFormat,
    filename?: string
  ) => {
    try {
      const formatted = formatExport(data, format);
      const finalFilename = filename || generateFilename(format);
      const mimeType = getMimeType(format);
      downloadAsFile(formatted, finalFilename, mimeType);
      toast.success(`Downloaded as ${finalFilename}`);
    } catch (err) {
      console.error('Re-export failed:', err);
      toast.error('Re-export failed. Please try again.');
    }
  }, []);

  const handleCopy = useCallback(async (data: ExtractedData[], format: ExportFormat) => {
    try {
      const formatted = formatExport(data, format);
      await navigator.clipboard.writeText(formatted);
      toast.success('Copied to clipboard');
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      toast.error('Failed to copy to clipboard');
    }
  }, [formatExport]);

  return (
    <div className="h-screen w-full flex flex-col text-glass-primary">
      {/* Error Alert */}
      {extractionErrors.length > 0 && (
        <ExtractionErrorAlert
          errors={extractionErrors}
          onDismiss={() => {
            setExtractionErrors([]);
            setExtractionStatus('idle');
          }}
        />
      )}

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 pt-6 space-y-3">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-glass-muted">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading tabs...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-400">
            <p className="text-sm font-medium">Error loading tabs</p>
            <p className="text-xs text-glass-muted mt-1">{error}</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-glass-muted">
            <p className="text-sm font-medium">No extractable tabs found</p>
            <p className="text-xs text-glass-muted/70 mt-1">
              Only HTTP/HTTPS pages can be extracted
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <DomainGroup
              key={group.domain}
              group={group}
              selectionState={getDomainSelectionState(group)}
              isTabSelected={isTabSelected}
              onToggleDomain={() => toggleDomain(group)}
              onToggleTab={toggleTab}
            />
          ))
        )}
      </main>

      {/* Footer */}
      <Footer
        selectedCount={selectedCount}
        isExtracting={isExtracting}
        isRefreshing={isRefreshing}
        extractionStatus={extractionStatus}
        extractionErrors={extractionErrors}
        onExtract={handleExtract}
        onRefresh={handleRefresh}
        onCancel={clearSelection}
        tabsToRightCount={tabsToRightCount}
        onExtractToRight={handleExtractToRight}
        isExtractingToRight={isExtractingToRight}
        toRightExtractionStatus={toRightExtractionStatus}
        toRightExtractionErrors={toRightExtractionErrors}
        highlightedCount={highlightedCount}
        onExtractHighlighted={handleExtractHighlighted}
        isExtractingHighlighted={isExtractingHighlighted}
        highlightedExtractionStatus={highlightedExtractionStatus}
        highlightedExtractionErrors={highlightedExtractionErrors}
        onOpenHistory={handleOpenHistory}
        onOpenExportModal={handleOpenExportModal}
        closeTabsEnabled={closeTabsEnabled}
        onToggleCloseTabs={toggleCloseTabs}
      />

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={handleCloseExportModal}
        data={lastExtractedData.length > 0 ? lastExtractedData : []}
        onExportComplete={handleExportFromModal}
      />

      {/* History Panel */}
      <HistoryPanel
        isOpen={isHistoryPanelOpen}
        onClose={handleCloseHistory}
        entries={history.entries}
        count={history.count}
        isLoading={history.isLoading}
        error={history.error}
        hasMore={history.hasMore}
        onLoadMore={history.loadMore}
        onDelete={history.deleteEntry}
        onClearAll={history.clearAll}
        onSearch={history.search}
        onClearSearch={history.clearSearch}
        onReExport={handleReExport}
        onCopy={handleCopy}
      />
    </div>
  );
}
