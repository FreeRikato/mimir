export interface ChromeTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
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

export interface SubtitlesMetadata {
  id: string;
  title: string;
  channel: string;
}

export interface SubtitlesResponse {
  success: boolean;
  metadata: SubtitlesMetadata;
  subtitles: string[];
  count: number;
  error?: string;
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
