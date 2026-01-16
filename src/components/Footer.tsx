import { RefreshCw, X, Copy, CheckCircle, Loader2, AlertTriangle, AlertCircle } from 'lucide-react';
import type { ExtractionStatus, ExtractionErrorInfo } from '../types';

interface FooterProps {
  selectedCount: number;
  isExtracting: boolean;
  isRefreshing: boolean;
  extractionStatus: ExtractionStatus;
  extractionErrors: ExtractionErrorInfo[];
  onExtract: () => void;
  onRefresh: () => void;
  onCancel: () => void;
}

export function Footer({
  selectedCount,
  isExtracting,
  isRefreshing,
  extractionStatus,
  extractionErrors,
  onExtract,
  onRefresh,
  onCancel,
}: FooterProps) {
  const isExtractDisabled = selectedCount === 0 || isExtracting;
  const showCancel = selectedCount > 0 && !isExtracting;
  const failedCount = extractionErrors.length;

  return (
    <div className="sticky bottom-0 z-10 glass-heavy px-4 py-3 border-t border-white/8">
      <div className="flex items-center gap-2">
        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="
            flex-shrink-0 p-2.5 rounded-lg glass-hover glass-focus
            text-glass-secondary hover:text-glass-primary
            disabled:opacity-50 disabled:cursor-not-allowed
          "
          title="Refresh tabs"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Cancel Button (conditional) */}
        {showCancel && (
          <button
            onClick={onCancel}
            className="
              flex-shrink-0 p-2.5 rounded-lg glass-hover glass-focus
              text-red-400 hover:text-red-300
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            title="Clear selection"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Copy Button */}
        <button
          onClick={onExtract}
          disabled={isExtractDisabled}
          className={`
            flex-1 py-2.5 px-4 rounded-lg font-medium
            flex items-center justify-center gap-2
            transition-all duration-300 transform glass-focus
            ${isExtractDisabled
              ? 'glass-heavy text-glass-muted cursor-not-allowed'
              : extractionStatus === 'success'
                ? 'glass-teal text-teal-300 border border-teal-500/30'
                : extractionStatus === 'partial'
                  ? 'glass-amber text-amber-300 border border-amber-500/30'
                  : extractionStatus === 'error'
                    ? 'glass-red text-red-300 border border-red-500/30'
                    : 'glass-heavy text-white border border-white/10 hover:scale-[1.02]'
            }
          `}
        >
          {isExtracting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Extracting...</span>
            </>
          ) : extractionStatus === 'success' ? (
            <>
              <CheckCircle className="w-5 h-5" />
              <span>Copied!</span>
            </>
          ) : extractionStatus === 'partial' ? (
            <>
              <AlertTriangle className="w-5 h-5" />
              <span>Partial ({failedCount} failed)</span>
            </>
          ) : extractionStatus === 'error' ? (
            <>
              <AlertCircle className="w-5 h-5" />
              <span>Extraction failed</span>
            </>
          ) : selectedCount === 0 ? (
            <span>Select tabs</span>
          ) : (
            <>
              <Copy className="w-5 h-5" />
              <span>Copy {selectedCount}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
