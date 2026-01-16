import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTabs } from './hooks/useTabs';
import { useSelection } from './hooks/useSelection';
import { DomainGroup } from './components/DomainGroup';
import { Footer } from './components/Footer';
import { ExtractionErrorAlert } from './components/ExtractionErrorAlert';
import { getPageHTML } from './utils/scripting';
import { isYouTubeUrl } from './utils/youtube';
import { fetchYoutubeSubtitles } from './utils/subtitles';
import type { ExtractedData, ExtractionResult, ExtractionErrorInfo, ExtractionStatus } from './types';
import { SubtitleError } from './types';

export function SidePanelApp() {
  const { groups, isLoading, error, refresh } = useTabs();
  const {
    selectedCount,
    selectedIds,
    isTabSelected,
    getDomainSelectionState,
    toggleTab,
    toggleDomain,
    clearSelection,
  } = useSelection();

  const [isExtracting, setIsExtracting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>('idle');
  const [extractionErrors, setExtractionErrors] = useState<ExtractionErrorInfo[]>([]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    clearSelection();
    await refresh();
    setIsRefreshing(false);
  }, [refresh, clearSelection]);

  const handleExtract = useCallback(async () => {
    if (selectedIds.length === 0) return;

    setIsExtracting(true);
    setExtractionStatus('extracting');
    setExtractionErrors([]);
    toast.loading('Extracting content...', { id: 'extract-status' });

    const errors: ExtractionErrorInfo[] = [];

    try {
      const results = await Promise.all(
        selectedIds.map(async (id): Promise<ExtractedData | null> => {
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
                toast.error(
                  'YouTube subtitle extraction failed - backend may be unavailable',
                  { id: `extract-${id}`, duration: 5000 }
                );
                return null;
              }
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
              `Failed: ${tab?.title?.substring(0, 30)}...`,
              { id: `extract-${id}`, duration: 3000 }
            );
            return null;
          }
        })
      );

      setExtractionErrors(errors);

      const validResults = results.filter((r): r is ExtractedData => r !== null);
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      toast.dismiss('extract-status');

      if (errors.length > 0) {
        setExtractionStatus('partial');
        if (validResults.length > 0) {
          toast.success(`Extracted content from ${validResults.length} tab${validResults.length > 1 ? 's' : ''}`);
        }
      } else {
        setExtractionStatus('success');
        toast.success(`Extracted content from ${validResults.length} tab${validResults.length > 1 ? 's' : ''}`);
        setTimeout(() => {
          setExtractionStatus('idle');
        }, 2000);
      }

      toast.success('Copied to clipboard!', { id: 'clipboard-success', duration: 2000 });
    } catch (err) {
      console.error('Extraction failed:', err);
      setExtractionStatus('error');
      toast.error('Content extraction failed. Please try again.');
    } finally {
      setIsExtracting(false);
    }
  }, [selectedIds]);

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
      />
    </div>
  );
}
