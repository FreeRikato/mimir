import { useRef, useEffect, useState } from 'react';
import { X, Clock, Trash2, Loader2, FileText, FileJson, FileSpreadsheet, Globe } from 'lucide-react';
import type { HistoryEntry, ExtractedData, ExportFormat } from '../types';
import { HistoryItem } from './HistoryItem';
import { SearchBar } from './SearchBar';
import { ExportFormatModal } from './ExportFormatModal';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  entries: HistoryEntry[];
  count: number;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onSearch: (query: { keywords?: string; dateFrom?: number; dateTo?: number }) => void;
  onClearSearch: () => void;
  onExportFromFormatModal: (data: ExtractedData[], format: ExportFormat, filename: string) => Promise<void> | void;
  onCopy: (data: ExtractedData[], format: ExportFormat) => void;
}

const FORMAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  json: FileJson,
  markdown: FileText,
  text: FileText,
  csv: FileSpreadsheet,
  html: Globe,
};

export function HistoryPanel({
  isOpen,
  onClose,
  entries,
  count,
  isLoading,
  error,
  hasMore,
  onLoadMore,
  onDelete,
  onClearAll,
  onSearch,
  onClearSearch,
  onExportFromFormatModal,
  onCopy,
}: HistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [formatModalEntry, setFormatModalEntry] = useState<HistoryEntry | null>(null);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Infinite scroll for load more
  useEffect(() => {
    if (!isOpen || !hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [isOpen, hasMore, isLoading, onLoadMore]);

  if (!isOpen) return null;

  const handleOpenExportFormatModal = (entry: HistoryEntry) => {
    setFormatModalEntry(entry);
  };

  const handleExportFromFormatModal = async (data: ExtractedData[], format: ExportFormat, filename: string) => {
    await onExportFromFormatModal(data, format, filename);
    setFormatModalEntry(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-md h-full glass-heavy border-l border-white/10 shadow-2xl
                   flex flex-col animate-in slide-in-from-right-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-white" />
            <h2 className="text-lg font-semibold text-glass-primary">Extraction History</h2>
            <span className="px-2 py-0.5 rounded-full glass-heavy text-xs text-glass-muted border border-white/10">
              {count}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {entries.length > 0 && (
              <button
                onClick={onClearAll}
                className="p-2 rounded-lg glass-hover text-glass-secondary hover:text-red-400 transition-colors"
                title="Clear all history"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg glass-hover text-glass-secondary hover:text-glass-primary transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-white/10 shrink-0">
          <SearchBar onSearch={onSearch} onClearSearch={onClearSearch} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-glass-muted p-8">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">Loading history...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-red-400 p-8">
              <p className="text-sm font-medium">Error loading history</p>
              <p className="text-xs text-glass-muted mt-1">{error}</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-glass-muted p-8">
              <Clock className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm font-medium text-glass-secondary">No extraction history</p>
              <p className="text-xs text-glass-muted mt-1 text-center max-w-[200px]">
                Your extracted content will appear here
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {entries.map((entry) => {
                const FormatIcon = FORMAT_ICONS[entry.format] || FileText;
                return (
                  <HistoryItem
                    key={entry.id}
                    entry={entry}
                    FormatIcon={FormatIcon}
                    onOpenExportFormatModal={() => handleOpenExportFormatModal(entry)}
                    onDelete={() => onDelete(entry.id)}
                    onCopy={() => onCopy(entry.data, entry.format)}
                  />
                );
              })}
              {hasMore && (
                <div
                  ref={loadMoreRef}
                  className="flex items-center justify-center py-4 text-glass-muted"
                >
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Export Format Modal */}
      <ExportFormatModal
        isOpen={formatModalEntry !== null}
        onClose={() => setFormatModalEntry(null)}
        data={formatModalEntry?.data || []}
        onExportComplete={handleExportFromFormatModal}
      />
    </div>
  );
}
