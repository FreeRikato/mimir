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
	contentType?: "html" | "youtube" | "pdf";
	extractionMethod?: "dom" | "subtitles" | "pdf-text" | "pdf-hybrid";
	charCount?: number;
	pageCount?: number;
	truncated?: boolean;
}

export interface ExtractionResult {
	text: string;
	title: string;
	url: string;
}

// Subtitle entry from JSON API response
export interface SubtitleEntry {
	start: string;
	end: string;
	text: string;
}

// Subtitle extraction formats
export type SubtitleExtractionFormat = "json" | "vtt" | "text";

// Subtitle fetch options
export interface SubtitleFetchOptions {
	format?: SubtitleExtractionFormat;
	timeoutMs?: number;
	maxRetries?: number;
	onRetry?: (attempt: number, error: SubtitleError) => void;
	signal?: AbortSignal;
}

// FastAPI JSON response format (format=json)
export interface FastApiSubtitleResponse {
	video_id: string;
	language: string;
	subtitle_count: number;
	subtitles: SubtitleEntry[];
	metadata: {
		video_id: string;
		title: string;
		duration?: number;
		duration_formatted?: string;
		channel?: string;
		description?: string;
		thumbnail?: string;
		webpage_url?: string;
		extractor?: string;
	};
}

// FastAPI VTT response format (format=vtt)
// Returns raw WebVTT text, not JSON

// FastAPI text response format (format=text)
export interface FastApiTextResponse {
	video_id: string;
	title: string;
	text: string;
}

// FastAPI error response format
export interface FastApiErrorResponse {
	error: string;
	message: string;
	detail?: string;
}

export type SubtitleErrorCode =
	| "INVALID_URL"
	| "NETWORK_ERROR"
	| "TIMEOUT"
	| "SERVER_ERROR"
	| "API_ERROR"
	| "PARSE_ERROR"
	| "NO_SUBTITLES"
	| "RETRY_EXHAUSTED"
	| "PDF_ACCESS_DENIED"
	| "PDF_UNSUPPORTED"
	| "PDF_TOO_LARGE"
	| "OCR_UNAVAILABLE";

export interface PdfExtractionMeta {
	usedOcr: boolean;
	truncated: boolean;
	charCount: number;
	pageCount: number;
}

export interface PdfExtractionResponse {
	title: string;
	text: string;
	meta: PdfExtractionMeta;
}

export interface PdfExtractionOptions {
	timeoutMs?: number;
	maxRetries?: number;
	onRetry?: (attempt: number, error: SubtitleError) => void;
	signal?: AbortSignal;
}

export type PdfCandidateSourceType = "remote" | "local" | "viewer" | "unknown";

export interface PdfCandidate {
	isPdf: boolean;
	sourceUrl?: string;
	sourceType: PdfCandidateSourceType;
}

export class SubtitleError extends Error {
	public readonly code: SubtitleErrorCode;
	public readonly originalError?: Error;
	public readonly url?: string;

	constructor(message: string, code: SubtitleErrorCode, originalError?: Error, url?: string) {
		super(message);
		this.name = "SubtitleError";
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

export type ExtractionStatus = "idle" | "extracting" | "success" | "partial" | "error";

// Export & Storage types
export type ExportFormat = "json" | "markdown" | "text" | "csv" | "html";
export type ExportAction = "clipboard" | "file";

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
