import { useState, useCallback } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useTabs } from './hooks/useTabs';
import { useSelection } from './hooks/useSelection';
import { DomainGroup } from './components/DomainGroup';
import { ExtractionButton } from './components/ExtractionButton';
import { getPageHTML } from './utils/scripting';
import type { ExtractedData, ExtractionResult } from './types';

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
  const [isSuccess, setIsSuccess] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    clearSelection();
    await refresh();
    setIsRefreshing(false);
  }, [refresh, clearSelection]);

  const handleExtract = useCallback(async () => {
    if (selectedIds.length === 0) return;

    setIsExtracting(true);
    setIsSuccess(false);

    try {
      const results = await Promise.all(
        selectedIds.map(async (id): Promise<ExtractedData | null> => {
          try {
            const injection = await chrome.scripting.executeScript({
              target: { tabId: id },
              func: getPageHTML,
            });

            const result = injection[0]?.result as ExtractionResult | undefined;
            
            if (!result) return null;

            return {
              id,
              timestamp: new Date().toISOString(),
              title: result.title,
              url: result.url,
              html: result.html,
            };
          } catch (err) {
            console.error(`Failed to extract tab ${id}:`, err);
            return null;
          }
        })
      );

      const validResults = results.filter((r): r is ExtractedData => r !== null);
      const jsonString = JSON.stringify(validResults, null, 2);
      await navigator.clipboard.writeText(jsonString);

      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 2000);
    } catch (err) {
      console.error('Extraction failed:', err);
    } finally {
      setIsExtracting(false);
    }
  }, [selectedIds]);

  return (
    <div className="h-screen w-full flex flex-col bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-800">Mimir</h1>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="
              p-2 rounded-lg text-gray-600 
              hover:bg-gray-100 hover:text-gray-800
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors duration-150
            "
            title="Refresh tabs"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading tabs...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500">
            <p className="text-sm font-medium">Error loading tabs</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-sm font-medium">No extractable tabs found</p>
            <p className="text-xs text-gray-400 mt-1">
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
      <footer className="sticky bottom-0 z-10 bg-white border-t border-gray-200 px-4 py-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <ExtractionButton
          selectedCount={selectedCount}
          isExtracting={isExtracting}
          isSuccess={isSuccess}
          onExtract={handleExtract}
        />
      </footer>
    </div>
  );
}
