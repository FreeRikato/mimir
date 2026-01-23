export interface ChromeTab {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  favIconUrl?: string;
  highlighted?: boolean;
  active?: boolean;
}

export interface DomainGroup {
  domain: string;
  tabs: ChromeTab[];
  favicon?: string;
}

export interface ExtractedData {
  id: number;
  title: string;
  url: string;
  timestamp: string;
  text: string;
}

export interface ExtractionResult {
  text: string;
  title: string;
  url: string;
}

// FastAPI text response format
export interface FastApiSubtitleResponse {
  video_id: string;
  language: string;
  text: string;
  metadata: {
    video_id: string;
    title: string;
    duration?: number;
    duration_formatted?: string;
    channel?: string;
  };
}

// FastAPI error response format
export interface FastApiErrorResponse {
  error: string;
  message: string;
  detail?: string;
}

export type SubtitleErrorCode =
  | 'INVALID_URL'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'API_ERROR'
  | 'PARSE_ERROR'
  | 'NO_SUBTITLES'
  | 'RETRY_EXHAUSTED';

export class SubtitleError extends Error {
  public readonly code: SubtitleErrorCode;
  public readonly originalError?: Error;
  public readonly url?: string;

  constructor(
    message: string,
    code: SubtitleErrorCode,
    originalError?: Error,
    url?: string
  ) {
    super(message);
    this.name = 'SubtitleError';
    this.code = code;
    this.originalError = originalError;
    this.url = url;
  }
}

export interface ExtractionErrorInfo {
  tabId: number;
  url: string;
  title: string;
  errorCode: SubtitleErrorCode;
  userMessage: string;
}

export type ExtractionStatus = 'idle' | 'extracting' | 'success' | 'partial' | 'error';

// Export & Storage types
export type ExportFormat = 'json' | 'markdown' | 'text' | 'csv' | 'html';
export type ExportAction = 'clipboard' | 'file';

export interface ExportOptions {
  format: ExportFormat;
  action: ExportAction;
  filename?: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  format: ExportFormat;
  exportType: ExportAction;
  tabCount: number;
  domains: string[];
  data: ExtractedData[];
  filename?: string;
  dataSize: number;
}

export interface SearchQuery {
  keywords?: string;
  dateFrom?: number;
  dateTo?: number;
  domains?: string[];
}

export interface SearchFilters {
  keywords: string;
  dateRange: { start: Date | null; end: Date | null };
  domains: string[];
}

export interface ExtractionProgress {
  total: number;
  completed: number;
  failed: number;
  currentTabId: number | null;
  currentTabTitle: string | null;
  startTime: number;
  isCancelled: boolean;
}

export interface ProgressUpdate {
  completed: number;
  failed: number;
  total: number;
  currentTab: {
    id: number;
    title: string;
  } | null;
}

export type ProgressCallback = (progress: ProgressUpdate) => void;
