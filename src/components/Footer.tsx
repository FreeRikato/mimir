import { RefreshCw, X, Copy, CheckCircle, Loader2, AlertTriangle, AlertCircle, ArrowRight, Highlighter } from 'lucide-react';
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
  // Tabs to right props
  tabsToRightCount: number;
  onExtractToRight: () => void;
  isExtractingToRight: boolean;
  toRightExtractionStatus: ExtractionStatus;
  toRightExtractionErrors: ExtractionErrorInfo[];
  // Highlighted tabs props
  highlightedCount: number;
  onExtractHighlighted: () => void;
  isExtractingHighlighted: boolean;
  highlightedExtractionStatus: ExtractionStatus;
  highlightedExtractionErrors: ExtractionErrorInfo[];
}

export function Footer({
  selectedCount,
  isExtracting,
  isRefreshing,
  extractionStatus,
  extractionErrors: _extractionErrors, // eslint-disable-line @typescript-eslint/no-unused-vars
  onExtract,
  onRefresh,
  onCancel,
  // Tabs to right props
  tabsToRightCount,
  onExtractToRight,
  isExtractingToRight,
  toRightExtractionStatus,
  toRightExtractionErrors: _toRightExtractionErrors, // eslint-disable-line @typescript-eslint/no-unused-vars
  // Highlighted tabs props
  highlightedCount,
  onExtractHighlighted,
  isExtractingHighlighted,
  highlightedExtractionStatus,
  highlightedExtractionErrors: _highlightedExtractionErrors, // eslint-disable-line @typescript-eslint/no-unused-vars
}: FooterProps) {
  const isExtractDisabled = selectedCount === 0 || isExtracting || isExtractingToRight || isExtractingHighlighted;
  const showCancel = selectedCount > 0 && !isExtracting && !isExtractingToRight && !isExtractingHighlighted;
  const isExtractToRightDisabled = tabsToRightCount === 0 || isExtracting || isExtractingToRight || isExtractingHighlighted;
  const isExtractHighlightedDisabled = highlightedCount === 0 || isExtracting || isExtractingToRight || isExtractingHighlighted;

  const getButtonClassName = (isDisabled: boolean, status: ExtractionStatus, colorVariant: 'orange' | 'purple' | 'teal') => `
    flex-shrink-0 w-11 h-11 rounded-lg glass-hover glass-focus
    flex items-center justify-center
    transition-all duration-300 transform
    ${isDisabled
      ? 'glass-heavy text-glass-muted cursor-not-allowed'
      : status === 'success'
        ? `glass-${colorVariant} text-${colorVariant}-300 border border-${colorVariant}-500/30`
        : status === 'partial'
          ? 'glass-amber text-amber-300 border border-amber-500/30'
          : status === 'error'
            ? 'glass-red text-red-300 border border-red-500/30'
            : 'glass-heavy text-white border border-white/10 hover:scale-[1.02]'
    }
  `;

  return (
    <div className="sticky bottom-0 z-10 glass-heavy px-4 py-3 border-t border-white/8">
      <div className="flex items-center justify-center gap-2">
        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex-shrink-0 w-11 h-11 rounded-lg glass-hover glass-focus text-glass-secondary hover:text-glass-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          title="Refresh tabs"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Cancel Button (conditional) */}
        {showCancel && (
          <button
            onClick={onCancel}
            className="flex-shrink-0 w-11 h-11 rounded-lg glass-hover glass-focus text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            title="Clear selection"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Tabs to Right Button */}
        <button
          onClick={onExtractToRight}
          disabled={isExtractToRightDisabled}
          className={getButtonClassName(isExtractToRightDisabled, toRightExtractionStatus, 'orange')}
          title="Extract content from tabs to the right of current tab"
        >
          {isExtractingToRight ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : toRightExtractionStatus === 'success' ? (
            <CheckCircle className="w-5 h-5" />
          ) : toRightExtractionStatus === 'partial' ? (
            <AlertTriangle className="w-5 h-5" />
          ) : toRightExtractionStatus === 'error' ? (
            <AlertCircle className="w-5 h-5" />
          ) : (
            <ArrowRight className="w-5 h-5" />
          )}
        </button>

        {/* Highlighted Tabs Button */}
        <button
          onClick={onExtractHighlighted}
          disabled={isExtractHighlightedDisabled}
          className={getButtonClassName(isExtractHighlightedDisabled, highlightedExtractionStatus, 'purple')}
          title="Extract content from tabs selected in Chrome's tab bar (Cmd+click / Shift+click)"
        >
          {isExtractingHighlighted ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : highlightedExtractionStatus === 'success' ? (
            <CheckCircle className="w-5 h-5" />
          ) : highlightedExtractionStatus === 'partial' ? (
            <AlertTriangle className="w-5 h-5" />
          ) : highlightedExtractionStatus === 'error' ? (
            <AlertCircle className="w-5 h-5" />
          ) : (
            <Highlighter className="w-5 h-5" />
          )}
        </button>

        {/* Copy Button */}
        <button
          onClick={onExtract}
          disabled={isExtractDisabled}
          className={getButtonClassName(isExtractDisabled, extractionStatus, 'teal')}
          title={`Copy ${selectedCount} selected tab${selectedCount !== 1 ? 's' : ''}`}
        >
          {isExtracting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : extractionStatus === 'success' ? (
            <CheckCircle className="w-5 h-5" />
          ) : extractionStatus === 'partial' ? (
            <AlertTriangle className="w-5 h-5" />
          ) : extractionStatus === 'error' ? (
            <AlertCircle className="w-5 h-5" />
          ) : (
            <Copy className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
}
