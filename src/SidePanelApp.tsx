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
import type { ExtractedData, ExtractionResult, ExtractionErrorInfo, ExtractionStatus, ExportFormat, ExtractionProgress } from './types';
import { ExtractionProgress as ExtractionProgressComponent } from './components/ExtractionProgress';
import { SubtitleError } from './types';

// Custom hook to auto-hide progress bars after cancellation
function useAutoHideProgress(
  progress: ExtractionProgress | null,
  setProgress: React.Dispatch<React.SetStateAction<ExtractionProgress | null>>,
  delay: number = 1500
) {
  useEffect(() => {
    if (progress?.isCancelled) {
      const timeout = setTimeout(() => setProgress(null), delay);
      return () => clearTimeout(timeout);
    }
  }, [progress?.isCancelled, setProgress, delay]);
}

// Helper function to extract a single tab
async function extractTab(
  id: number,
  signal?: AbortSignal
): Promise<{ result: ExtractedData | null; error: ExtractionErrorInfo | null }> {
  // Check for cancellation at start
  if (signal?.aborted) {
    return { result: null, error: null };
  }

  let tab: chrome.tabs.Tab | null = null;
  try {
    tab = await chrome.tabs.get(id);
    if (!tab.url) {
      console.warn(`Tab ${id}: No URL found`);
      return { result: null, error: null };
    }

    const tabUrl = tab.url;

    // Check for cancellation before expensive operations
    if (signal?.aborted) {
      return { result: null, error: null };
    }

    if (isYouTubeUrl(tabUrl)) {
      try {
        const { title, text } = await fetchYoutubeSubtitles(tabUrl, {
          onRetry: (attempt, err) => {
            console.warn(`Retry ${attempt} for ${tabUrl}:`, err.message);
          },
          signal,
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
        // Check if error was due to abort
        if (signal?.aborted) {
          return { result: null, error: null };
        }
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

    // Check for cancellation before script injection
    if (signal?.aborted) {
      return { result: null, error: null };
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

    // Skip cache write if aborted
    if (!signal?.aborted) {
      await setCachedContent(id, { text: result.text, title: result.title, url: result.url });
    }

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
    // Check if error was due to abort
    if (signal?.aborted) {
      return { result: null, error: null };
    }
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

// Helper to extract tabs concurrently with progress tracking
function extractTabsConcurrent(
  tabIds: number[],
  signal: AbortSignal | undefined,
  onProgress?: (update: {
    completed: number;
    failed: number;
    total: number;
    currentTab: { id: number; title: string } | null;
  }) => void
): Promise<{ results: ExtractedData[]; errors: ExtractionErrorInfo[]; cancelled: boolean }> {

  const CONCURRENCY_LIMIT = 3;
  const SINGLE_TAB_TIMEOUT = 8000;

  return new Promise((resolve) => {
    const results: ExtractedData[] = [];
    const errors: ExtractionErrorInfo[] = [];
    let completed = 0;
    let failed = 0;
    let cancelled = false;

    const queue = [...tabIds];
    const active = new Set<number>();

    const processNext = async (): Promise<void> => {
      if (signal?.aborted) {
        cancelled = true;
        checkDone();
        return;
      }

      const tabId = queue.shift();
      if (tabId === undefined) {
        checkDone();
        return;
      }

      active.add(tabId);

      let currentTabTitle = 'Untitled';
      let currentTabUrl = 'unknown';
      try {
        const tab = await chrome.tabs.get(tabId);
        currentTabTitle = tab.title || 'Untitled';
        currentTabUrl = tab.url || 'unknown';
      } catch {
        // Tab might be closed
      }

      // Report progress with actual tab title
      onProgress?.({
        completed,
        failed,
        total: tabIds.length,
        currentTab: { id: tabId, title: currentTabTitle }
      });

      try {
        // Create combined signal for timeout + user cancellation
        const timeoutSignal = AbortSignal.timeout(SINGLE_TAB_TIMEOUT);
        const combinedSignal = signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal;

        const { result, error } = await extractTab(tabId, combinedSignal);

        // Check if extraction timed out or was cancelled
        if (!result && !error) {
          if (timeoutSignal.aborted) {
            errors.push({
              tabId,
              url: currentTabUrl,
              title: currentTabTitle,
              errorCode: 'TIMEOUT',
              userMessage: 'Extraction timed out after 8 seconds'
            });
            failed++;
          }
          // If user cancelled, don't add error - just stop processing
        } else if (error) {
          errors.push(error);
          failed++;
        } else if (result) {
          results.push(result);
          completed++;
        }

        onProgress?.({
          completed,
          failed,
          total: tabIds.length,
          currentTab: null
        });

      } catch (err) {
        errors.push({
          tabId,
          url: 'unknown',
          title: currentTabTitle,
          errorCode: 'NETWORK_ERROR',
          userMessage: err instanceof Error ? err.message : 'Unknown error'
        });
        failed++;
      } finally {
        active.delete(tabId);
        if (queue.length > 0 && !signal?.aborted) {
          await processNext();
        } else {
          checkDone();
        }
      }
    };

    let workersDone = 0;
    // checkDone() is called when a worker's queue chain ends.
    // Each worker calls checkDone() exactly once when it has no more tabs to process.
    // When workersDone equals the number of initial workers, all tabs are done.
    const checkDone = () => {
      workersDone++;
      if (workersDone >= Math.min(CONCURRENCY_LIMIT, tabIds.length)) {
        resolve({ results, errors, cancelled });
      }
    };

    for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, tabIds.length); i++) {
      processNext();
    }
  });
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

  // Progress tracking state
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [toRightAbortController, setToRightAbortController] = useState<AbortController | null>(null);
  const [toRightExtractionProgress, setToRightExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [highlightedAbortController, setHighlightedAbortController] = useState<AbortController | null>(null);
  const [highlightedExtractionProgress, setHighlightedExtractionProgress] = useState<ExtractionProgress | null>(null);

  // Auto-hide progress bars after cancellation
  useAutoHideProgress(extractionProgress, setExtractionProgress);
  useAutoHideProgress(toRightExtractionProgress, setToRightExtractionProgress);
  useAutoHideProgress(highlightedExtractionProgress, setHighlightedExtractionProgress);

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

    // Create abort controller for this extraction
    const controller = new AbortController();
    setAbortController(controller);

    setIsExtracting(true);
    setExtractionStatus('extracting');
    setExtractionErrors([]);

    // Initialize progress state
    setExtractionProgress({
      total: selectedIds.length,
      completed: 0,
      failed: 0,
      currentTabId: null,
      currentTabTitle: null,
      startTime: Date.now(),
      isCancelled: false
    });

    try {
      const { results, errors, cancelled } = await extractTabsConcurrent(
        selectedIds,
        controller.signal,
        (update) => {
          setExtractionProgress(prev => prev ? {
            ...prev,
            completed: update.completed,
            failed: update.failed,
            currentTabId: update.currentTab?.id ?? null,
            currentTabTitle: update.currentTab?.title ?? null,
          } : null);
        }
      );

      setExtractionErrors(errors);
      const validResults = results;

      // Always copy valid results to clipboard, even if cancelled
      if (validResults.length > 0) {
        const jsonString = JSON.stringify(validResults, null, 2);
        await navigator.clipboard.writeText(jsonString);

        // Only save to history and close tabs if not cancelled
        if (!cancelled) {
          await history.addEntry(validResults, 'json', 'clipboard');
          setLastExtractedData(validResults);

          // Close tabs if setting is enabled
          if (closeTabsEnabled) {
            const { closed } = await closeTabsSafely(validResults.map((r) => r.id));
            if (closed > 0) {
              clearSelection();
            }
          }
        }
      }

      if (cancelled) {
        setExtractionStatus('idle');
        toast.success(`Cancelled. ${validResults.length} tab${validResults.length === 1 ? '' : 's'} copied to clipboard.`, {
          icon: '⚠️',
        });
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
      setExtractionProgress(null);
      setAbortController(null);
    }
  }, [getSelectedIdsAsArray, history, closeTabsEnabled, clearSelection]);

  const handleCancelExtraction = useCallback(() => {
    abortController?.abort();
    setExtractionProgress(prev => prev ? { ...prev, isCancelled: true } : null);
  }, [abortController]);

  const handleCancelToRightExtraction = useCallback(() => {
    toRightAbortController?.abort();
    setToRightExtractionProgress(prev => prev ? { ...prev, isCancelled: true } : null);
  }, [toRightAbortController]);

  const handleCancelHighlightedExtraction = useCallback(() => {
    highlightedAbortController?.abort();
    setHighlightedExtractionProgress(prev => prev ? { ...prev, isCancelled: true } : null);
  }, [highlightedAbortController]);

  const handleExtractToRight = useCallback(async () => {
    const tabsToRight = await getTabsToRight();
    const tabIds = tabsToRight.map((t) => t.id);

    if (tabIds.length === 0) return;

    // Create abort controller for this extraction
    const controller = new AbortController();
    setToRightAbortController(controller);

    setIsExtractingToRight(true);
    setToRightExtractionStatus('extracting');
    setToRightExtractionErrors([]);

    // Initialize progress state
    setToRightExtractionProgress({
      total: tabIds.length,
      completed: 0,
      failed: 0,
      currentTabId: null,
      currentTabTitle: null,
      startTime: Date.now(),
      isCancelled: false
    });

    try {
      const { results, errors, cancelled } = await extractTabsConcurrent(
        tabIds,
        controller.signal,
        (update) => {
          setToRightExtractionProgress(prev => prev ? {
            ...prev,
            completed: update.completed,
            failed: update.failed,
            currentTabId: update.currentTab?.id ?? null,
            currentTabTitle: update.currentTab?.title ?? null,
          } : null);
        }
      );

      setToRightExtractionErrors(errors);
      const validResults = results;

      // Always copy valid results to clipboard, even if cancelled
      if (validResults.length > 0) {
        const jsonString = JSON.stringify(validResults, null, 2);
        await navigator.clipboard.writeText(jsonString);

        // Only save to history and close tabs if not cancelled
        if (!cancelled) {
          await history.addEntry(validResults, 'json', 'clipboard');
          setLastExtractedData(validResults);

          // Close tabs if setting is enabled
          if (closeTabsEnabled) {
            const { closed } = await closeTabsSafely(validResults.map((r) => r.id));
            if (closed > 0) {
              clearSelection();
            }
          }
        }
      }

      if (cancelled) {
        setToRightExtractionStatus('idle');
        toast.success(`Cancelled. ${validResults.length} tab${validResults.length === 1 ? '' : 's'} copied to clipboard.`, {
          icon: '⚠️',
        });
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
      setToRightExtractionProgress(null);
      setToRightAbortController(null);
    }
  }, [history, closeTabsEnabled, clearSelection]);

  const handleExtractHighlighted = useCallback(async () => {
    const tabIds = highlightedTabs.map((t) => t.id);

    if (tabIds.length === 0) return;

    // Create abort controller for this extraction
    const controller = new AbortController();
    setHighlightedAbortController(controller);

    setIsExtractingHighlighted(true);
    setHighlightedExtractionStatus('extracting');
    setHighlightedExtractionErrors([]);

    // Initialize progress state
    setHighlightedExtractionProgress({
      total: tabIds.length,
      completed: 0,
      failed: 0,
      currentTabId: null,
      currentTabTitle: null,
      startTime: Date.now(),
      isCancelled: false
    });

    try {
      const { results, errors, cancelled } = await extractTabsConcurrent(
        tabIds,
        controller.signal,
        (update) => {
          setHighlightedExtractionProgress(prev => prev ? {
            ...prev,
            completed: update.completed,
            failed: update.failed,
            currentTabId: update.currentTab?.id ?? null,
            currentTabTitle: update.currentTab?.title ?? null,
          } : null);
        }
      );

      setHighlightedExtractionErrors(errors);
      const validResults = results;

      // Always copy valid results to clipboard, even if cancelled
      if (validResults.length > 0) {
        const jsonString = JSON.stringify(validResults, null, 2);
        await navigator.clipboard.writeText(jsonString);

        // Only save to history and close tabs if not cancelled
        if (!cancelled) {
          await history.addEntry(validResults, 'json', 'clipboard');
          setLastExtractedData(validResults);

          // Close tabs if setting is enabled
          if (closeTabsEnabled) {
            const { closed } = await closeTabsSafely(validResults.map((r) => r.id));
            if (closed > 0) {
              clearSelection();
            }
          }
        }
      }

      if (cancelled) {
        setHighlightedExtractionStatus('idle');
        toast.success(`Cancelled. ${validResults.length} tab${validResults.length === 1 ? '' : 's'} copied to clipboard.`, {
          icon: '⚠️',
        });
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
      setHighlightedExtractionProgress(null);
      setHighlightedAbortController(null);
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
      {/* Progress Bars - show all active extractions */}
      {extractionProgress && (
        <div className="sticky top-0 z-20 px-4 pt-4">
          <ExtractionProgressComponent
            progress={extractionProgress}
            onCancel={handleCancelExtraction}
          />
        </div>
      )}
      {toRightExtractionProgress && (
        <div className="sticky top-0 z-20 px-4 pt-4">
          <ExtractionProgressComponent
            progress={toRightExtractionProgress}
            onCancel={handleCancelToRightExtraction}
          />
        </div>
      )}
      {highlightedExtractionProgress && (
        <div className="sticky top-0 z-20 px-4 pt-4">
          <ExtractionProgressComponent
            progress={highlightedExtractionProgress}
            onCancel={handleCancelHighlightedExtraction}
          />
        </div>
      )}

      {/* Error Alert */}
      {extractionErrors.length > 0 && !extractionProgress && (
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
