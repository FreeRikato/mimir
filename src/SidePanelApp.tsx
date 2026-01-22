import { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTabs } from './hooks/useTabs';
import { useSelection } from './hooks/useSelection';
import { useHighlightedTabs } from './hooks/useHighlightedTabs';
import { DomainGroup } from './components/DomainGroup';
import { Footer } from './components/Footer';
import { ExtractionErrorAlert } from './components/ExtractionErrorAlert';
import { getPageHTML } from './utils/scripting';
import { isYouTubeUrl } from './utils/youtube';
import { fetchYoutubeSubtitles } from './utils/subtitles';
import { getCachedContent, setCachedContent } from './utils/cache';
import { getTabsToRight } from './utils/tabHelpers';
import type { ExtractedData, ExtractionResult, ExtractionErrorInfo, ExtractionStatus } from './types';
import { SubtitleError } from './types';

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

    const errors: ExtractionErrorInfo[] = [];

    try {
      const results = await Promise.all(
        selectedIds.map(async (id: number): Promise<ExtractedData | null> => {
          let tab: chrome.tabs.Tab | null = null;
          try {
            tab = await chrome.tabs.get(id);
            if (!tab.url) {
              console.warn(`Tab ${id}: No URL found`);
              return null;
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
                  id,
                  timestamp: new Date().toISOString(),
                  title,
                  url: tabUrl,
                  text,
                };
              } catch (err) {
                const errorInfo = createExtractionError(id, tab, err);
                errors.push(errorInfo);
                console.error(`Failed to extract YouTube subtitles for tab ${id}:`, err);
                return null;
              }
            }

            const cachedContent = await getCachedContent(id);
            if (cachedContent) {
              return {
                id,
                timestamp: new Date().toISOString(),
                title: cachedContent.title,
                url: cachedContent.url,
                text: cachedContent.text,
              };
            }

            const injection = await chrome.scripting.executeScript({
              target: { tabId: id },
              func: getPageHTML,
            });

            const result = injection[0]?.result as ExtractionResult | undefined;

            if (!result) {
              console.warn(`Tab ${id}: No content extracted (tab may be suspended or not loaded)`);
              return null;
            }

            await setCachedContent(id, { text: result.text, title: result.title, url: result.url });

            return {
              id,
              timestamp: new Date().toISOString(),
              title: result.title,
              url: result.url,
              text: result.text,
            };
          } catch (err) {
            const errorInfo = createExtractionError(id, tab, err);
            errors.push(errorInfo);
            console.error(`Failed to extract tab ${id}:`, err);
            return null;
          }
        })
      );

      setExtractionErrors(errors);

      const validResults = results.filter((r): r is ExtractedData => r !== null);
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      toast.dismiss('extract-status');

      if (errors.length > 0 && validResults.length === 0) {
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
  }, [getSelectedIdsAsArray]);

  const handleExtractToRight = useCallback(async () => {
    const tabsToRight = await getTabsToRight();
    const tabIds = tabsToRight.map((t) => t.id);

    if (tabIds.length === 0) return;

    setIsExtractingToRight(true);
    setToRightExtractionStatus('extracting');
    setToRightExtractionErrors([]);
    toast.loading('Extracting content from tabs to the right...', { id: 'extract-to-right-status' });

    const errors: ExtractionErrorInfo[] = [];

    try {
      const results = await Promise.all(
        tabIds.map(async (id): Promise<ExtractedData | null> => {
          let tab: chrome.tabs.Tab | null = null;
          try {
            tab = await chrome.tabs.get(id);
            if (!tab.url) {
              console.warn(`Tab ${id}: No URL found`);
              return null;
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
                  id,
                  timestamp: new Date().toISOString(),
                  title,
                  url: tabUrl,
                  text,
                };
              } catch (err) {
                const errorInfo = createExtractionError(id, tab, err);
                errors.push(errorInfo);
                console.error(`Failed to extract YouTube subtitles for tab ${id}:`, err);
                return null;
              }
            }

            const cachedContent = await getCachedContent(id);
            if (cachedContent) {
              return {
                id,
                timestamp: new Date().toISOString(),
                title: cachedContent.title,
                url: cachedContent.url,
                text: cachedContent.text,
              };
            }

            const injection = await chrome.scripting.executeScript({
              target: { tabId: id },
              func: getPageHTML,
            });

            const result = injection[0]?.result as ExtractionResult | undefined;

            if (!result) {
              console.warn(`Tab ${id}: No content extracted (tab may be suspended or not loaded)`);
              return null;
            }

            await setCachedContent(id, { text: result.text, title: result.title, url: result.url });

            return {
              id,
              timestamp: new Date().toISOString(),
              title: result.title,
              url: result.url,
              text: result.text,
            };
          } catch (err) {
            const errorInfo = createExtractionError(id, tab, err);
            errors.push(errorInfo);
            console.error(`Failed to extract tab ${id}:`, err);
            toast.error(
              `Failed: ${tab?.title?.substring(0, 20)}...`,
              { id: `extract-to-right-${id}`, duration: 3000 }
            );
            return null;
          }
        })
      );

      setToRightExtractionErrors(errors);

      const validResults = results.filter((r): r is ExtractedData => r !== null);
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      toast.dismiss('extract-to-right-status');

      if (errors.length > 0 && validResults.length === 0) {
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
  }, []);

  const handleExtractHighlighted = useCallback(async () => {
    const tabIds = highlightedTabs.map((t) => t.id);

    if (tabIds.length === 0) return;

    setIsExtractingHighlighted(true);
    setHighlightedExtractionStatus('extracting');
    setHighlightedExtractionErrors([]);
    toast.loading('Extracting content from highlighted tabs...', { id: 'extract-highlighted-status' });

    const errors: ExtractionErrorInfo[] = [];

    try {
      const results = await Promise.all(
        tabIds.map(async (id): Promise<ExtractedData | null> => {
          let tab: chrome.tabs.Tab | null = null;
          try {
            tab = await chrome.tabs.get(id);
            if (!tab.url) {
              console.warn(`Tab ${id}: No URL found`);
              return null;
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
                  id,
                  timestamp: new Date().toISOString(),
                  title,
                  url: tabUrl,
                  text,
                };
              } catch (err) {
                const errorInfo = createExtractionError(id, tab, err);
                errors.push(errorInfo);
                console.error(`Failed to extract YouTube subtitles for tab ${id}:`, err);
                return null;
              }
            }

            const cachedContent = await getCachedContent(id);
            if (cachedContent) {
              return {
                id,
                timestamp: new Date().toISOString(),
                title: cachedContent.title,
                url: cachedContent.url,
                text: cachedContent.text,
              };
            }

            const injection = await chrome.scripting.executeScript({
              target: { tabId: id },
              func: getPageHTML,
            });

            const result = injection[0]?.result as ExtractionResult | undefined;

            if (!result) {
              console.warn(`Tab ${id}: No content extracted (tab may be suspended or not loaded)`);
              return null;
            }

            await setCachedContent(id, { text: result.text, title: result.title, url: result.url });

            return {
              id,
              timestamp: new Date().toISOString(),
              title: result.title,
              url: result.url,
              text: result.text,
            };
          } catch (err) {
            const errorInfo = createExtractionError(id, tab, err);
            errors.push(errorInfo);
            console.error(`Failed to extract tab ${id}:`, err);
            toast.error(
              `Failed: ${tab?.title?.substring(0, 20)}...`,
              { id: `extract-highlighted-${id}`, duration: 3000 }
            );
            return null;
          }
        })
      );

      setHighlightedExtractionErrors(errors);

      const validResults = results.filter((r): r is ExtractedData => r !== null);
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      toast.dismiss('extract-highlighted-status');

      if (errors.length > 0 && validResults.length === 0) {
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
  }, [highlightedTabs]);

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
      />
    </div>
  );
}
