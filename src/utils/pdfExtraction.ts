import type { PdfExtractionOptions, PdfExtractionResponse } from "../types";
import { SubtitleError } from "../types";

const PDF_REQUEST_TIMEOUT_MS = 60000;
const PDF_RETRY_MAX_ATTEMPTS = 2;
const PDF_RETRY_BASE_DELAY_MS = 600;
const PDF_RETRY_MAX_DELAY_MS = 4000;

const SUBTITLES_BASE_URL = import.meta.env.VITE_SUBTITLES_BASE_URL ?? "";
interface PdfBackgroundResponse {
	success: boolean;
	data?: unknown;
	error?: string;
	status?: number;
	statusText?: string;
}

interface PdfBackendSuccessPayload {
	title?: string;
	text?: string;
	merged_text?: string;
	meta?: {
		used_ocr?: boolean;
		truncated?: boolean;
		char_count?: number;
		page_count?: number;
	};
}

function normalizeBaseUrl(baseUrl: string): string {
	let normalized = baseUrl || (import.meta.env.DEV ? "127.0.0.1:8000" : "");
	if (!normalized) {
		throw new SubtitleError("SUBTITLES_BASE_URL environment variable not set", "NETWORK_ERROR");
	}
	if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
		normalized = `http://${normalized}`;
	}
	return normalized.replace("localhost", "127.0.0.1");
}

function getPdfApiUrl(): string {
	const baseUrl = normalizeBaseUrl(SUBTITLES_BASE_URL);
	return `${baseUrl}/extract/pdf`;
}

function getRetryDelay(attempt: number): number {
	const exponentialDelay = PDF_RETRY_BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 10));
	const jitter = Math.random() * 0.2 * exponentialDelay;
	return Math.min(exponentialDelay + jitter, PDF_RETRY_MAX_DELAY_MS);
}

function mapPdfStatusToError(message: string, status?: number, url?: string): SubtitleError {
	if (status === 413) {
		return new SubtitleError(message || "PDF too large", "PDF_TOO_LARGE", undefined, url);
	}
	if (status === 415 || status === 422) {
		return new SubtitleError(message || "Unsupported PDF", "PDF_UNSUPPORTED", undefined, url);
	}
	if (status === 423 || status === 451) {
		return new SubtitleError(message || "Cannot access PDF", "PDF_ACCESS_DENIED", undefined, url);
	}
	if (status === 503) {
		return new SubtitleError(message || "OCR backend unavailable", "OCR_UNAVAILABLE", undefined, url);
	}
	if (status !== undefined && status >= 500) {
		return new SubtitleError(message || `Backend server error: ${status}`, "SERVER_ERROR", undefined, url);
	}
	return new SubtitleError(message || "PDF extraction failed", "API_ERROR", undefined, url);
}

function isRetryableError(error: SubtitleError): boolean {
	if (error.code === "TIMEOUT") return true;
	if (error.code === "NETWORK_ERROR") return true;
	if (error.code === "SERVER_ERROR") return true;
	if (error.code === "OCR_UNAVAILABLE") return true;
	return false;
}

async function fetchPdfFromBackground(
	pdfUrl: string,
	timeoutMs: number,
	externalSignal?: AbortSignal,
): Promise<PdfExtractionResponse> {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new SubtitleError(`PDF extraction timed out after ${timeoutMs}ms`, "TIMEOUT", undefined, pdfUrl));
		}, timeoutMs);

		if (externalSignal?.aborted) {
			clearTimeout(timeoutId);
			reject(new SubtitleError("Operation cancelled", "NETWORK_ERROR", undefined, pdfUrl));
			return;
		}

		try {
			chrome.runtime.sendMessage(
				{ type: "EXTRACT_PDF", url: pdfUrl, apiUrl: getPdfApiUrl() },
				(response?: PdfBackgroundResponse) => {
					clearTimeout(timeoutId);

					if (chrome.runtime.lastError) {
						reject(
							new SubtitleError(
								chrome.runtime.lastError.message || "Background messaging failed",
								"NETWORK_ERROR",
								undefined,
								pdfUrl,
							),
						);
						return;
					}

					if (!response) {
						reject(new SubtitleError("No response from background worker", "NETWORK_ERROR", undefined, pdfUrl));
						return;
					}

					if (!response.success) {
						reject(mapPdfStatusToError(response.error || "PDF extraction failed", response.status, pdfUrl));
						return;
					}

					const data = (response.data || {}) as PdfBackendSuccessPayload;
					const text = typeof data.merged_text === "string" ? data.merged_text : data.text || "";
					if (!text.trim()) {
						reject(new SubtitleError("No text found in PDF", "PDF_UNSUPPORTED", undefined, pdfUrl));
						return;
					}

					resolve({
						title: data.title || "Untitled PDF",
						text,
						meta: {
							usedOcr: Boolean(data.meta?.used_ocr),
							truncated: Boolean(data.meta?.truncated),
							charCount: typeof data.meta?.char_count === "number" ? data.meta.char_count : text.length,
							pageCount: typeof data.meta?.page_count === "number" ? data.meta.page_count : 0,
						},
					});
				},
			);
		} catch (err) {
			clearTimeout(timeoutId);
			reject(
				err instanceof SubtitleError
					? err
					: new SubtitleError(
							err instanceof Error ? err.message : "PDF extraction failed",
							"NETWORK_ERROR",
							err instanceof Error ? err : undefined,
							pdfUrl,
						),
			);
		}
	});
}

async function fetchWithRetry<T>(
	fetchFn: () => Promise<T>,
	maxAttempts: number,
	onRetry?: (attempt: number, error: SubtitleError) => void,
	signal?: AbortSignal,
): Promise<T> {
	let lastError: SubtitleError | undefined;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (signal?.aborted) {
			throw new SubtitleError("Operation cancelled", "NETWORK_ERROR");
		}

		try {
			return await fetchFn();
		} catch (err) {
			const extractionError =
				err instanceof SubtitleError
					? err
					: new SubtitleError(
							err instanceof Error ? err.message : "Unknown error",
							"NETWORK_ERROR",
							err instanceof Error ? err : undefined,
						);
			lastError = extractionError;

			if (attempt === maxAttempts - 1 || !isRetryableError(extractionError)) {
				throw extractionError;
			}

			onRetry?.(attempt + 1, extractionError);
			const delay = getRetryDelay(attempt);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

export async function extractPdfContent(
	pdfUrl: string,
	options: PdfExtractionOptions = {},
): Promise<PdfExtractionResponse> {
	const { timeoutMs = PDF_REQUEST_TIMEOUT_MS, maxRetries = PDF_RETRY_MAX_ATTEMPTS, onRetry, signal } = options;

	return fetchWithRetry(() => fetchPdfFromBackground(pdfUrl, timeoutMs, signal), maxRetries, onRetry, signal);
}
