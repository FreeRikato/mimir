import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Trash2, Calendar, HardDrive, FileText } from 'lucide-react';
import type { HistoryEntry } from '../types';

interface HistoryItemProps {
  entry: HistoryEntry;
  FormatIcon: React.ComponentType<{ className?: string }>;
  onReExport: () => void;
  onDelete: () => void;
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
  return date.toLocaleDateString();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFormatBadgeColor(format: string): string {
  switch (format) {
    case 'json':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'markdown':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'text':
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    case 'csv':
      return 'bg-green-500/20 text-green-300 border-green-500/30';
    case 'html':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
    default:
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  }
}

export function HistoryItem({ entry, FormatIcon, onReExport, onDelete }: HistoryItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="glass-medium rounded-xl overflow-hidden transition-all duration-200 hover:border-white/20">
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        {/* Expand/Collapse Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 rounded-lg glass-hover text-glass-muted hover:text-glass-primary transition-colors shrink-0"
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
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${getFormatBadgeColor(entry.format)}`}>
              {entry.format.toUpperCase()}
            </span>
            {entry.exportType === 'file' && (
              <span className="text-[10px] text-glass-muted flex items-center gap-1">
                <Download className="w-3 h-3" />
                File
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-glass-muted">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {entry.tabCount} tab{entry.tabCount !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatRelativeTime(entry.timestamp)}
            </span>
            {entry.dataSize > 0 && (
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" />
                {formatBytes(entry.dataSize)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onReExport}
            className="p-2 rounded-lg glass-hover text-glass-secondary hover:text-teal-400 transition-colors"
            title="Re-export"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg glass-hover text-glass-secondary hover:text-red-400 transition-colors"
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

            {/* Timestamp */}
            <div>
              <p className="text-xs text-glass-muted mb-1.5">Extracted</p>
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
