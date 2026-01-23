import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Trash2, Clock, Copy } from 'lucide-react';
import type { HistoryEntry } from '../types';

interface HistoryItemProps {
  entry: HistoryEntry;
  FormatIcon: React.ComponentType<{ className?: string }>;
  onOpenExportFormatModal: () => void;
  onDelete: () => void;
  onCopy: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function HistoryItem({ entry, FormatIcon, onOpenExportFormatModal, onDelete, onCopy }: HistoryItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDelete = () => {
    if (window.confirm('Delete this extraction history?')) {
      onDelete();
    }
  };

  // Build metadata parts
  const metadataParts: string[] = [];
  metadataParts.push(`${entry.tabCount} tab${entry.tabCount !== 1 ? 's' : ''}`);
  if (entry.dataSize > 0) {
    metadataParts.push(formatBytes(entry.dataSize));
  }

  return (
    <div className="glass-medium rounded-xl overflow-hidden transition-all duration-200 hover:border-white/20 hover:bg-white/5">
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        {/* Expand/Collapse Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 rounded-lg glass-hover text-glass-muted hover:text-glass-primary transition-colors shrink-0"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        {/* Format Icon */}
        <div className="p-2 rounded-lg bg-white/5 shrink-0">
          <FormatIcon className="w-4 h-4 text-glass-secondary" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Primary: Timestamp */}
          <div className="text-sm font-semibold text-glass-primary mb-0.5 truncate">
            {formatRelativeTime(entry.timestamp)}
          </div>

          {/* Metadata: tabs • size */}
          <div className="flex items-center gap-2 text-xs text-glass-muted">
            <span className="flex items-center gap-1">
              {metadataParts.join(' • ')}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onCopy}
            className="p-2.5 rounded-lg glass-hover text-glass-secondary hover:text-violet-400 transition-colors"
            title="Copy to clipboard"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenExportFormatModal}
            className="p-2.5 rounded-lg glass-hover text-glass-secondary hover:text-teal-400 transition-colors"
            title="Export"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handleDelete}
            className="p-2.5 rounded-lg glass-hover text-glass-secondary hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-white/5 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="pt-3 space-y-2">
            {/* Domains */}
            <div>
              <p className="text-xs text-glass-muted mb-1.5">Domains ({entry.domains.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.domains.slice(0, 5).map((domain, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-glass-secondary"
                  >
                    {domain}
                  </span>
                ))}
                {entry.domains.length > 5 && (
                  <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-glass-muted">
                    +{entry.domains.length - 5} more
                  </span>
                )}
              </div>
            </div>

            {/* Filename (for file exports) */}
            {entry.filename && (
              <div>
                <p className="text-xs text-glass-muted mb-1.5">Filename</p>
                <p className="text-xs text-glass-secondary font-mono bg-black/30 px-2 py-1 rounded border border-white/5 truncate">
                  {entry.filename}
                </p>
              </div>
            )}

            {/* Timestamp with clock icon */}
            <div>
              <p className="text-xs text-glass-muted mb-1.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Extracted
              </p>
              <p className="text-xs text-glass-secondary">
                {new Date(entry.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
