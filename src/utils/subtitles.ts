import toast from "react-hot-toast";
import type {
	FastApiErrorResponse,
	FastApiSubtitleResponse,
	FastApiTextResponse,
	SubtitleEntry,
	SubtitleExtractionFormat,
	SubtitleFetchOptions,
} from "../types";
import { SubtitleError } from "../types";
import { checkBackendHealth, clearHealthCheckCache as clearHealthCache } from "./backendHealth";
import { loadBackendUnavailableToastFlag, setBackendUnavailableToastFlag } from "./backendToastFlag";
import { normalizeBackendBaseUrl } from "./backendUrl";
import { isYouTubeUrl, normalizeYouTubeUrl } from "./youtube";

const SUBTITLES_BASE_URL = import.meta.env.VITE_SUBTITLES_BASE_URL ?? "";
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 100000;

const SUBTITLE_CACHE_PREFIX = "subtitle_";
const SUBTITLE_CACHE_TTL = 3600000; // 1 hour

// Chrome storage.local has effectively unlimited storage (limited by available disk space)
// Setting a very high limit to avoid quota issues while still preventing abuse
const SUBTITLE_CACHE_MAX_SIZE = 100 * 1024 * 1024; // 100MB in bytes

// Metadata key for tracking subtitle cache entries and their sizes
const SUBTITLE_CACHE_METADATA_KEY = "mimir_subtitle_metadata";

interface SubtitleCacheEntry {
	title: string;
	text: string;
	subtitles: SubtitleEntry[];
	subtitleCount: number;
	format: SubtitleExtractionFormat;
	timestamp: number;
	size: number;
	accessCount: number;
	lastAccess: number;
}

interface SubtitleCacheMetadata {
	// Track size and access info for each subtitle cache key
	entries: {
		key: string;
		size: number;
		lastAccess: number;
		accessCount: number;
		timestamp: number;
	}[];
	totalSize: number;
}

/**
 * Approximates the size of a value in bytes when stored in chrome.storage.local
 * Uses UTF-16 encoding (2 bytes per character) as a reasonable approximation
 */
function calculateSize(value: unknown): number {
	try {
		// JSON.stringify gives us a reasonable approximation of the storage size
		// Multiplying by 2 accounts for UTF-16 encoding used by JavaScript strings
		const str = JSON.stringify(value);
		return str.length * 2;
	} catch {
		// If we can't stringify, return a conservative estimate
		return 1024; // 1KB default
	}
}

/**
 * Loads subtitle cache metadata from chrome.storage.local
 */
async function getSubtitleCacheMetadata(): Promise<SubtitleCacheMetadata> {
	try {
		const cached = await chrome.storage.local.get([SUBTITLE_CACHE_METADATA_KEY]);
		return (cached[SUBTITLE_CACHE_METADATA_KEY] as SubtitleCacheMetadata) || { entries: [], totalSize: 0 };
	} catch {
		return { entries: [], totalSize: 0 };
	}
}

/**
 * Saves subtitle cache metadata to chrome.storage.local
 */
async function setSubtitleCacheMetadata(metadata: SubtitleCacheMetadata): Promise<void> {
	try {
		await chrome.storage.local.set({ [SUBTITLE_CACHE_METADATA_KEY]: metadata });
	} catch (err) {
		console.warn("[Subtitle Cache] Failed to save cache metadata:", err);
	}
}

/**
 * Updates metadata for a specific subtitle cache entry
 */
async function updateSubtitleEntryMetadata(
	key: string,
	size: number,
	timestamp: number,
	isAccess: boolean = false,
): Promise<void> {
	const metadata = await getSubtitleCacheMetadata();
	const existingIndex = metadata.entries.findIndex((e) => e.key === key);

	if (existingIndex >= 0) {
		// Update existing entry
		const entry = metadata.entries[existingIndex];
		if (isAccess) {
			// On access, update lastAccess time and increment count
			entry.lastAccess = Date.now();
			entry.accessCount++;
		} else {
			// On set, update size and timestamp
			const oldSize = entry.size;
			entry.size = size;
			entry.timestamp = timestamp;
			entry.lastAccess = timestamp;
			entry.accessCount++;
			metadata.totalSize += size - oldSize;
		}
	} else {
		// Add new entry
		metadata.entries.push({
			key,
			size,
			timestamp,
			lastAccess: timestamp,
			accessCount: 1,
		});
		metadata.totalSize += size;
	}

	await setSubtitleCacheMetadata(metadata);
}

/**
 * Removes metadata for a specific subtitle cache entry
 */
async function removeSubtitleEntryMetadata(key: string): Promise<void> {
	const metadata = await getSubtitleCacheMetadata();
	const index = metadata.entries.findIndex((e) => e.key === key);

	if (index >= 0) {
		const entry = metadata.entries[index];
		metadata.totalSize -= entry.size;
		metadata.entries.splice(index, 1);
		await setSubtitleCacheMetadata(metadata);
	}
}

/**
 * Finds and removes the least recently used subtitle cache entry
 * Prioritizes expired entries first, then uses LRU
 */
async function evictSubtitleLRUEntry(): Promise<boolean> {
	const metadata = await getSubtitleCacheMetadata();
	if (metadata.entries.length === 0) {
		return false;
	}

	const now = Date.now();

	// First, try to find expired entries
	const expiredEntry = metadata.entries.find((e) => now - e.timestamp > SUBTITLE_CACHE_TTL);

	const entryToEvict =
		expiredEntry ||
		metadata.entries.reduce((oldest, entry) => {
			if (entry.lastAccess < oldest.lastAccess) {
				return entry;
			}
			// If lastAccess times are equal, use access count as secondary criteria
			if (entry.lastAccess === oldest.lastAccess && entry.accessCount < oldest.accessCount) {
				return entry;
			}
			return oldest;
		}, metadata.entries[0]);

	try {
		await chrome.storage.local.remove([entryToEvict.key]);
		await removeSubtitleEntryMetadata(entryToEvict.key);
		console.debug(`[Subtitle Cache] Evicted entry: ${entryToEvict.key} (${entryToEvict.size} bytes)`);
		return true;
	} catch (err) {
		console.warn(`[Subtitle Cache] Failed to evict entry ${entryToEvict.key}:`, err);
		return false;
	}
}

/**
 * Ensures there's enough space in the subtitle cache for a new entry
 * Evicts LRU entries until there's sufficient space
 */
async function ensureSubtitleCacheSpace(requiredSize: number): Promise<void> {
	const metadata = await getSubtitleCacheMetadata();

	// Check if we need to evict entries
	if (metadata.totalSize + requiredSize <= SUBTITLE_CACHE_MAX_SIZE) {
		return; // Enough space available
	}

	const maxEvictions = 100; // Safety limit to prevent infinite loops
	let evictions = 0;

	while (
		(await getSubtitleCacheMetadata()).totalSize + requiredSize > SUBTITLE_CACHE_MAX_SIZE &&
		evictions < maxEvictions
	) {
		const evicted = await evictSubtitleLRUEntry();
		if (!evicted) {
			// Couldn't evict more entries (cache is empty or failed)
			break;
		}
		evictions++;
	}

	if (evictions > 0) {
		console.debug(`[Subtitle Cache] Evicted ${evictions} entries to free up space`);
	}
}

/**
 * Parse WebVTT format into SubtitleEntry array
 * WebVTT format example:
 * WEBVTT
 *
 * 00:00:00.000 --> 00:00:02.500
 * First subtitle line
 *
 * 00:00:02.500 --> 00:00:05.000
 * Second subtitle line
 */
function parseVtt(vttContent: string): { subtitles: SubtitleEntry[]; text: string } {
	// Guard against null/undefined input
	if (vttContent == null || typeof vttContent !== "string") {
		return { subtitles: [], text: "" };
	}

	const lines = vttContent.split("\n");
	const subtitles: SubtitleEntry[] = [];
	const textLines: string[] = [];

	let i = 0;
	// Skip header and empty lines until we find the first timestamp
	while (i < lines.length) {
		const line = lines[i]?.trim(); // Use optional chaining for safety
		if (line?.includes("-->") && line.match(/\d{2}:\d{2}:\d{2}/)) {
			break;
		}
		i++;
	}

	while (i < lines.length) {
		const line = lines[i]?.trim(); // Use optional chaining for safety

		// Look for timestamp line (contains -->)
		if (line?.includes("-->")) {
			const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
			if (timeMatch) {
				const start = timeMatch[1];
				const end = timeMatch[2];

				// Validate timestamp format
				if (start && end && start !== end) {
					// Collect text lines for this subtitle
					i++;
					const subtitleTextLines: string[] = [];
					while (i < lines.length) {
						const textLine = lines[i]?.trim();
						if (!textLine || textLine === "" || textLine.includes("-->")) {
							break;
						}
						if (textLine && !textLine.match(/NOTE|STYLE/)) {
							subtitleTextLines.push(textLine);
						}
						i++;
					}

					const text = subtitleTextLines.join(" ");
					if (text) {
						subtitles.push({ start, end, text });
						textLines.push(text);
					}
					continue;
				}
			}
		}
		i++;
	}

	return { subtitles, text: textLines.join("\n") };
}

async function extractVideoId(youtubeUrl: string): Promise<string> {
	const normalized = normalizeYouTubeUrl(youtubeUrl);
	const url = new URL(normalized);
	const videoId = url.searchParams.get("v");
	if (!videoId) {
		throw new SubtitleError("Could not extract video ID", "INVALID_URL", undefined, youtubeUrl);
	}
	return videoId;
}

async function getCachedSubtitle(
	videoId: string,
	format: SubtitleExtractionFormat,
	lang: string = "en",
): Promise<{ title: string; text: string; subtitles: SubtitleEntry[]; subtitleCount: number } | null> {
	try {
		const cacheKey = `${SUBTITLE_CACHE_PREFIX}${videoId}_${lang}_${format}`;
		const cached = await chrome.storage.local.get([cacheKey]);
		const entry = cached[cacheKey] as SubtitleCacheEntry | undefined;

		if (!entry) return null;

		// Check for expiration (1 hour TTL)
		if (Date.now() - entry.timestamp > SUBTITLE_CACHE_TTL) {
			await chrome.storage.local.remove([cacheKey]);
			await removeSubtitleEntryMetadata(cacheKey);
			return null;
		}

		// Update access tracking for LRU eviction
		await updateSubtitleEntryMetadata(cacheKey, entry.size, entry.timestamp, true);

		return { title: entry.title, text: entry.text, subtitles: entry.subtitles, subtitleCount: entry.subtitleCount };
	} catch (err) {
		// Cache read failures are non-fatal - we'll fetch from API instead
		const message = err instanceof Error ? err.message : String(err);
		console.warn(
			`[Subtitle Cache] Failed to read cached subtitles for video ${videoId}. Will fetch from API. Error: ${message}`,
		);
		return null;
	}
}

async function setCachedSubtitle(
	videoId: string,
	format: SubtitleExtractionFormat,
	data: { title: string; text: string; subtitles: SubtitleEntry[]; subtitleCount: number },
	lang: string = "en",
): Promise<void> {
	try {
		const cacheKey = `${SUBTITLE_CACHE_PREFIX}${videoId}_${lang}_${format}`;
		const timestamp = Date.now();
		const entry: SubtitleCacheEntry = {
			title: data.title,
			text: data.text,
			subtitles: data.subtitles,
			subtitleCount: data.subtitleCount,
			format,
			timestamp,
			size: 0, // Will be calculated below
			accessCount: 1,
			lastAccess: timestamp,
		};

		// Calculate entry size before writing
		const entrySize = calculateSize(entry);
		entry.size = entrySize;

		// Ensure there's enough space before writing
		await ensureSubtitleCacheSpace(entrySize);

		// Check if we're overwriting an existing entry
		const metadata = await getSubtitleCacheMetadata();
		const existingEntry = metadata.entries.find((e) => e.key === cacheKey);
		if (existingEntry) {
			// Account for the size of the entry we're replacing
			metadata.totalSize -= existingEntry.size;
		}

		// Write the cache entry
		try {
			await chrome.storage.local.set({ [cacheKey]: entry });
			// Update metadata after successful write
			await updateSubtitleEntryMetadata(cacheKey, entrySize, timestamp);
		} catch (setErr) {
			// If we get a quota error, try emergency eviction and retry
			if (setErr instanceof Error && (setErr.message.includes("QUOTA") || setErr.message.includes("quota"))) {
				console.warn("[Subtitle Cache] Storage quota exceeded, performing emergency eviction");

				// Try evicting multiple entries
				for (let i = 0; i < 5; i++) {
					await evictSubtitleLRUEntry();
				}

				// Retry write
				await chrome.storage.local.set({ [cacheKey]: entry });
				await updateSubtitleEntryMetadata(cacheKey, entrySize, timestamp);
			} else {
				throw setErr;
			}
		}
	} catch (err) {
		// Cache write failures are non-fatal - subtitles were successfully fetched, just not cached
		const message = err instanceof Error ? err.message : String(err);
		console.warn(
			`[Subtitle Cache] Failed to write subtitles for video ${videoId} to cache. Subtitles will still be returned. Error: ${message}`,
		);
		// Don't re-throw - caching is an optimization, not a requirement
	}
}

export function getSubtitlesApiUrl(
	youtubeUrl: string,
	format: SubtitleExtractionFormat = "json",
	lang?: string,
): string {
	const baseUrl = normalizeBackendBaseUrl(SUBTITLES_BASE_URL, import.meta.env.DEV);
	// Use format parameter to get subtitle data in requested format.
	// Only append `lang` when explicitly set so the backend keeps its default for legacy callers.
	const params = new URLSearchParams({ video_url: youtubeUrl, format });
	if (lang && /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) {
		params.set("lang", lang);
	}
	const url = `${baseUrl}/api/v1/subtitles?${params.toString()}`;
	console.log("Subtitles API URL:", url);
	return url;
}

export function getApiHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	return headers;
}

// Fetch through background service worker (more reliable in Manifest V3)
interface BackgroundFetchResponse {
	success: boolean;
	data?: unknown;
	error?: string;
	status?: number;
	statusText?: string;
}

async function fetchFromBackground(
	url: string,
	format: SubtitleExtractionFormat,
	timeoutMs = REQUEST_TIMEOUT_MS,
	externalSignal?: AbortSignal,
): Promise<Response> {
	return new Promise((resolve, reject) => {
		const startTime = Date.now();
		console.log("SidePanel: Starting fetchFromBackground for URL:", url, "format:", format);

		const timeoutId = setTimeout(() => {
			console.error("SidePanel: Request timed out after", timeoutMs, "ms");
			reject(buildTimeoutError(url, timeoutMs, SUBTITLES_BASE_URL));
		}, timeoutMs);

		// Check for external cancellation
		if (externalSignal?.aborted) {
			clearTimeout(timeoutId);
			reject(new SubtitleError("Operation cancelled", "NETWORK_ERROR", undefined, url));
			return;
		}

		try {
			console.log("SidePanel: Sending FETCH_SUBTITLES message to background worker...");
			chrome.runtime.sendMessage({ type: "FETCH_SUBTITLES", url, format }, (response?: BackgroundFetchResponse) => {
				clearTimeout(timeoutId);
				const elapsed = Date.now() - startTime;
				console.log(`SidePanel: Response received from background in ${elapsed}ms`);
				console.log("SidePanel: Response:", response);

				if (chrome.runtime.lastError) {
					console.error("SidePanel: chrome.runtime.lastError detected:", chrome.runtime.lastError.message);
					// Try direct fetch as fallback
					console.log("SidePanel: Trying direct fetch as fallback...");
					directFetchWithTimeout(url, format, timeoutMs).then(resolve).catch(reject);
					return;
				}

				if (!response) {
					console.log("SidePanel: No response from background, trying direct fetch...");
					directFetchWithTimeout(url, format, timeoutMs).then(resolve).catch(reject);
					return;
				}

				if (!response.success) {
					console.log("SidePanel: Background returned error:", response.error);

					// If background received a real HTTP response, return it directly without a second request.
					if (typeof response.status === "number") {
						const errorPayload = response.data ?? {
							detail: response.error || `API request failed: ${response.status}`,
						};
						const mockErrorResponse = {
							ok: false,
							status: response.status,
							statusText: response.statusText || "Error",
							json: () => Promise.resolve(errorPayload),
							text: () =>
								Promise.resolve(typeof errorPayload === "string" ? errorPayload : JSON.stringify(errorPayload)),
						} as unknown as Response;

						resolve(mockErrorResponse);
						return;
					}

					// Fall back to direct fetch only for runtime/background transport failures.
					console.log("SidePanel: Trying direct fetch as fallback...");
					directFetchWithTimeout(url, format, timeoutMs).then(resolve).catch(reject);
					return;
				}

				console.log("SidePanel: Successfully received subtitle data");
				// Create a mock Response object for compatibility
				// For VTT format, response.data is raw text; for JSON/text formats, it's parsed JSON
				const mockResponse = {
					ok: true,
					status: typeof response.status === "number" ? response.status : 200,
					statusText: response.statusText || "OK",
					json: () => Promise.resolve(response.data),
					text: () =>
						Promise.resolve(typeof response.data === "string" ? response.data : JSON.stringify(response.data)),
				} as unknown as Response;

				resolve(mockResponse);
			});
		} catch (err) {
			clearTimeout(timeoutId);
			console.error("SidePanel: Exception sending message:", err);
			// Try direct fetch as fallback
			console.log("SidePanel: Exception, trying direct fetch...");
			directFetchWithTimeout(url, format, timeoutMs).then(resolve).catch(reject);
		}
	});
}

// Direct fetch fallback
async function directFetchWithTimeout(
	url: string,
	format: SubtitleExtractionFormat,
	timeoutMs: number,
): Promise<Response> {
	console.log("SidePanel: Starting directFetchWithTimeout for URL:", url, "format:", format);
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		console.error("SidePanel: Direct fetch timed out after", timeoutMs, "ms");
		controller.abort();
	}, timeoutMs);

	try {
		console.log("SidePanel: Making direct fetch request...");
		const headers = getApiHeaders();
		const response = await fetch(url, { signal: controller.signal, headers });
		clearTimeout(timeoutId);
		console.log("SidePanel: Direct fetch completed with status:", response.status);
		return response;
	} catch (err) {
		clearTimeout(timeoutId);
		console.error("SidePanel: Direct fetch failed:", err);
		if (err instanceof Error && err.name === "AbortError") {
			throw new SubtitleError(`Request timed out after ${timeoutMs}ms`, "TIMEOUT", undefined, url);
		}
		throw new SubtitleError(
			`Network request failed: ${err instanceof Error ? err.message : "Unknown error"}. ${SUBTITLES_BASE_URL ? `Is the backend server reachable at ${SUBTITLES_BASE_URL}?` : "The backend server is unreachable."}`,
			"NETWORK_ERROR",
			err instanceof Error ? err : undefined,
			url,
		);
	}
}

async function fetchWithTimeout(
	url: string,
	format: SubtitleExtractionFormat,
	timeoutMs = REQUEST_TIMEOUT_MS,
	externalSignal?: AbortSignal,
): Promise<Response> {
	// Use background worker for Chrome extension context
	return fetchFromBackground(url, format, timeoutMs, externalSignal);
}

function getRetryDelay(attempt: number, baseDelay = RETRY_BASE_DELAY_MS, maxDelay = RETRY_MAX_DELAY_MS): number {
	// Cap attempt to prevent integer overflow with Math.pow(2, attempt)
	const cappedAttempt = Math.min(attempt, 30); // 2^30 is about 1 billion, well within safe range
	const exponentialDelay = baseDelay * Math.pow(2, cappedAttempt);

	// Check for Infinity as an extra safety measure
	if (!Number.isFinite(exponentialDelay)) {
		return maxDelay;
	}

	const jitter = Math.random() * 0.3 * exponentialDelay;
	return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Build the SubtitleError thrown when a request times out.
 *
 * Bug 1.1: the user-facing message used to hardcode "http://127.0.0.1:8000"
 * regardless of `VITE_SUBTITLES_BASE_URL`. Prod users running against a
 * real backend saw a misleading localhost hint. The new helper embeds the
 * *actual* configured base URL in the message and falls back to a generic
 * phrase when no base URL is configured.
 */
export function buildTimeoutError(url: string, timeoutMs: number, baseUrl: string): SubtitleError {
	const where = baseUrl ? ` at ${baseUrl}` : "";
	return new SubtitleError(
		`Request timed out after ${timeoutMs}ms. Is the backend server reachable${where}?`,
		"TIMEOUT",
		undefined,
		url,
	);
}

export function isRetryableError(error: SubtitleError): boolean {
	if (error.code === "TIMEOUT") return true;
	if (error.code === "NETWORK_ERROR") return true;
	if (error.code === "SERVER_ERROR") return true;
	if (error.code === "API_ERROR") {
		// Bug 1.2: statusCode was previously missing from SubtitleError, so this
		// branch was always returning false. With the field populated by callers,
		// transient 429/5xx errors are retried instead of failing on first attempt.
		// Bug 1.2: 429/5xx/408 are transient; other 4xx (400/401/403/404) should NOT retry.
		const statusCode = error.statusCode;
		if (statusCode === 408 || statusCode === 429) return true;
		if (statusCode !== undefined && statusCode >= 500) return true;
		return false;
	}
	return false;
}

async function fetchWithRetry<T>(
	fetchFn: () => Promise<T>,
	maxAttempts = RETRY_MAX_ATTEMPTS,
	onRetry?: (attempt: number, error: SubtitleError) => void,
	signal?: AbortSignal,
): Promise<T> {
	let lastError: SubtitleError | undefined;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// Check for cancellation before each attempt
		if (signal?.aborted) {
			throw new SubtitleError("Operation cancelled", "NETWORK_ERROR", undefined);
		}

		try {
			return await fetchFn();
		} catch (err) {
			const subtitleError =
				err instanceof SubtitleError
					? err
					: new SubtitleError(
							err instanceof Error ? err.message : "Unknown error",
							"NETWORK_ERROR",
							err instanceof Error ? err : undefined,
						);

			lastError = subtitleError;

			if (attempt === maxAttempts - 1 || !isRetryableError(subtitleError)) {
				throw subtitleError;
			}

			const delay = getRetryDelay(attempt);
			onRetry?.(attempt + 1, subtitleError);

			// Wait for delay with signal checking
			await new Promise((resolve, reject) => {
				const timeoutId = setTimeout(resolve, delay);
				signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(timeoutId);
						reject(new SubtitleError("Operation cancelled", "NETWORK_ERROR", undefined));
					},
					{ once: true },
				);
			});
		}
	}

	throw lastError;
}

// Export health check functions for external use
export { checkBackendHealth, clearHealthCheckCache as resetBackendHealthCheck } from "./backendHealth";

/**
 * Clears the health check cache and forces a fresh check on next attempt.
 * Use this when user manually retries subtitle fetching.
 */
export async function clearHealthCheckCache(): Promise<void> {
	await clearHealthCache();
	// Bug 1.8: also reset the persisted toast flag so a successful retry
	// re-arms the user notification.
	await setBackendUnavailableToastFlag(false);
}

export async function fetchYoutubeSubtitles(
	youtubeUrl: string,
	options: SubtitleFetchOptions = {},
): Promise<{ title: string; text: string; subtitles: SubtitleEntry[]; subtitleCount: number }> {
	const {
		format = "json",
		lang,
		timeoutMs = REQUEST_TIMEOUT_MS,
		maxRetries = RETRY_MAX_ATTEMPTS,
		onRetry,
		signal,
	} = options;
	const effectiveLang = lang && /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : "en";

	if (!isYouTubeUrl(youtubeUrl)) {
		throw new SubtitleError("Invalid YouTube URL", "INVALID_URL", undefined, youtubeUrl);
	}

	const videoId = await extractVideoId(youtubeUrl);

	// Check backend health before attempting fetch (unless user explicitly wants to retry)
	const isHealthy = await checkBackendHealth();
	if (!isHealthy) {
		// Skip retries if backend is known to be down
		const hasShown = await loadBackendUnavailableToastFlag();
		if (!hasShown) {
			toast.error("YouTube subtitle backend is unavailable. Subtitles will be skipped.", {
				id: "backend-unavailable",
				duration: 5000,
			});
			await setBackendUnavailableToastFlag(true);
		}
		throw new SubtitleError(
			"YouTube subtitle backend is unavailable. Subtitles will be skipped.",
			"NETWORK_ERROR",
			undefined,
			youtubeUrl,
		);
	} else {
		// Reset the toast flag if backend is healthy again so the user gets
		// re-notified if the backend goes down a second time.
		await setBackendUnavailableToastFlag(false);
	}

	const cached = await getCachedSubtitle(videoId, format, effectiveLang);
	if (cached) {
		return cached;
	}

	return fetchWithRetry(
		async () => {
			const normalizedUrl = normalizeYouTubeUrl(youtubeUrl);
			const apiUrl = getSubtitlesApiUrl(normalizedUrl, format, effectiveLang);
			const response = await fetchWithTimeout(apiUrl, format, timeoutMs, signal);

			if (!response.ok) {
				// Try to parse error response
				let errorBody: FastApiErrorResponse | null = null;
				try {
					errorBody = await response.json();
				} catch {
					// Ignore JSON parse errors
				}

				const errorType = errorBody?.error;
				const errorMessage = errorBody?.message || errorBody?.detail || `API request failed: ${response.status}`;

				// Map status codes to error codes
				if (response.status === 400 || errorType === "validation_error") {
					throw new SubtitleError(errorMessage, "INVALID_URL", undefined, youtubeUrl);
				}
				if (response.status === 404 || errorType === "download_failed" || errorType === "not_found") {
					throw new SubtitleError(errorMessage, "NO_SUBTITLES", undefined, youtubeUrl);
				}
				if (response.status === 429 || errorType === "rate_limit_exceeded") {
					throw new SubtitleError("Rate limit exceeded", "SERVER_ERROR", undefined, youtubeUrl, response.status);
				}
				if (response.status >= 500) {
					throw new SubtitleError(
						`Backend server error: ${response.status}`,
						"SERVER_ERROR",
						undefined,
						youtubeUrl,
						response.status,
					);
				}

				throw new SubtitleError(errorMessage, "API_ERROR", undefined, youtubeUrl, response.status);
			}

			let result: { title: string; text: string; subtitles: SubtitleEntry[]; subtitleCount: number };

			// Handle different response formats
			if (format === "json") {
				let data: FastApiSubtitleResponse;
				try {
					data = await response.json();
				} catch (err) {
					throw new SubtitleError(
						"Failed to parse API response",
						"PARSE_ERROR",
						err instanceof Error ? err : undefined,
						youtubeUrl,
					);
				}

				if (!data.subtitles || !Array.isArray(data.subtitles) || data.subtitles.length === 0) {
					throw new SubtitleError("No subtitles found for this video", "NO_SUBTITLES", undefined, youtubeUrl);
				}

				// Join subtitle texts with newlines
				const text = data.subtitles.map((s) => s.text).join("\n");
				const title = data.metadata.title;
				const subtitleCount = data.subtitle_count;
				const subtitles = data.subtitles;

				result = { title, text, subtitles, subtitleCount };
			} else if (format === "vtt") {
				// VTT format returns raw WebVTT text
				const vttContent = await response.text();
				if (!vttContent || vttContent.trim().length === 0) {
					throw new SubtitleError("No subtitles found for this video", "NO_SUBTITLES", undefined, youtubeUrl);
				}

				const parsed = parseVtt(vttContent);
				if (parsed.subtitles.length === 0) {
					throw new SubtitleError("No subtitles found for this video", "NO_SUBTITLES", undefined, youtubeUrl);
				}

				// Extract title from VTT if available, otherwise use video ID
				const titleMatch = vttContent.match(/Title:\s*(.+)/i);
				const title = titleMatch ? titleMatch[1].trim() : `YouTube Video ${videoId}`;

				result = {
					title,
					text: parsed.text,
					subtitles: parsed.subtitles,
					subtitleCount: parsed.subtitles.length,
				};
			} else {
				// text format
				let data: FastApiTextResponse;
				try {
					data = await response.json();
				} catch (err) {
					throw new SubtitleError(
						"Failed to parse API response",
						"PARSE_ERROR",
						err instanceof Error ? err : undefined,
						youtubeUrl,
					);
				}

				if (!data.text || data.text.trim().length === 0) {
					throw new SubtitleError("No subtitles found for this video", "NO_SUBTITLES", undefined, youtubeUrl);
				}

				result = {
					title: data.title || `YouTube Video ${videoId}`,
					text: data.text,
					subtitles: [], // No structured data in text format
					subtitleCount: 1,
				};
			}

			await setCachedSubtitle(videoId, format, result, effectiveLang);

			return result;
		},
		maxRetries,
		onRetry,
		signal,
	);
}
