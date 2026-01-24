import type { FastApiSubtitleResponse, FastApiErrorResponse } from '../types';
import { SubtitleError } from '../types';
import { isYouTubeUrl, normalizeYouTubeUrl } from './youtube';

const SUBTITLES_BASE_URL = import.meta.env.VITE_SUBTITLES_BASE_URL ?? '';

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 100000;

const SUBTITLE_CACHE_PREFIX = 'subtitle_';
const SUBTITLE_CACHE_TTL = 3600000; // 1 hour

interface SubtitleCacheEntry {
  title: string;
  text: string;
  timestamp: number;
}

async function extractVideoId(youtubeUrl: string): Promise<string> {
  const normalized = normalizeYouTubeUrl(youtubeUrl);
  const url = new URL(normalized);
  const videoId = url.searchParams.get('v');
  if (!videoId) {
    throw new SubtitleError('Could not extract video ID', 'INVALID_URL', undefined, youtubeUrl);
  }
  return videoId;
}

async function getCachedSubtitle(videoId: string): Promise<{ title: string; text: string } | null> {
  try {
    const cacheKey = `${SUBTITLE_CACHE_PREFIX}${videoId}`;
    const cached = await chrome.storage.local.get([cacheKey]);
    const entry = cached[cacheKey] as SubtitleCacheEntry | undefined;

    if (!entry) return null;

    if (Date.now() - entry.timestamp > SUBTITLE_CACHE_TTL) {
      await chrome.storage.local.remove([cacheKey]);
      return null;
    }

    return { title: entry.title, text: entry.text };
  } catch (err) {
    console.warn('Failed to load subtitle from cache:', err);
    return null;
  }
}

async function setCachedSubtitle(videoId: string, data: { title: string; text: string }): Promise<void> {
  try {
    const cacheKey = `${SUBTITLE_CACHE_PREFIX}${videoId}`;
    const entry: SubtitleCacheEntry = {
      title: data.title,
      text: data.text,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [cacheKey]: entry });
  } catch (err) {
    console.warn('Failed to write subtitle cache:', err);
  }
}

export function getSubtitlesApiUrl(youtubeUrl: string): string {
  let baseUrl = SUBTITLES_BASE_URL || (import.meta.env.DEV ? '127.0.0.1:8000' : '');
  if (!baseUrl) {
    throw new Error('SUBTITLES_BASE_URL environment variable not set');
  }
  // Add protocol if missing (Fetch API requires a proper URL scheme)
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'http://' + baseUrl;
  }
  // Normalize localhost to 127.0.0.1 (more reliable)
  baseUrl = baseUrl.replace('localhost', '127.0.0.1');
  // Use format=text to get plain text response
  const url = `${baseUrl}/api/v1/subtitles?video_url=${encodeURIComponent(youtubeUrl)}&format=text`;
  console.log('Subtitles API URL:', url);
  return url;
}

// Fetch through background service worker (more reliable in Manifest V3)
async function fetchFromBackground(url: string, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal?: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    console.log('SidePanel: Starting fetchFromBackground for URL:', url);

    const timeoutId = setTimeout(() => {
      console.error('SidePanel: Request timed out after', timeoutMs, 'ms');
      reject(new SubtitleError(
        `Request timed out after ${timeoutMs}ms. Is the backend server running at http://127.0.0.1:8000?`,
        'TIMEOUT',
        undefined,
        url
      ));
    }, timeoutMs);

    // Check for external cancellation
    if (externalSignal?.aborted) {
      clearTimeout(timeoutId);
      reject(new SubtitleError('Operation cancelled', 'NETWORK_ERROR', undefined, url));
      return;
    }

    try {
      console.log('SidePanel: Sending FETCH_SUBTITLES message to background worker...');
      chrome.runtime.sendMessage({ type: 'FETCH_SUBTITLES', url }, (response) => {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;
        console.log(`SidePanel: Response received from background in ${elapsed}ms`);
        console.log('SidePanel: Response:', response);

        if (chrome.runtime.lastError) {
          console.error('SidePanel: chrome.runtime.lastError detected:', chrome.runtime.lastError.message);
          // Try direct fetch as fallback
          console.log('SidePanel: Trying direct fetch as fallback...');
          directFetchWithTimeout(url, timeoutMs).then(resolve).catch(reject);
          return;
        }

        if (!response) {
          console.log('SidePanel: No response from background, trying direct fetch...');
          directFetchWithTimeout(url, timeoutMs).then(resolve).catch(reject);
          return;
        }

        if (!response.success) {
          console.log('SidePanel: Background returned error:', response.error);
          // Try direct fetch as fallback on error
          console.log('SidePanel: Trying direct fetch as fallback...');
          directFetchWithTimeout(url, timeoutMs).then(resolve).catch(reject);
          return;
        }

        console.log('SidePanel: Successfully received subtitle data');
        // Create a mock Response object for compatibility
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(response.data),
          text: () => Promise.resolve(JSON.stringify(response.data)),
        } as unknown as Response;

        resolve(mockResponse);
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('SidePanel: Exception sending message:', err);
      // Try direct fetch as fallback
      console.log('SidePanel: Exception, trying direct fetch...');
      directFetchWithTimeout(url, timeoutMs).then(resolve).catch(reject);
    }
  });
}

// Direct fetch fallback
async function directFetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  console.log('SidePanel: Starting directFetchWithTimeout for URL:', url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error('SidePanel: Direct fetch timed out after', timeoutMs, 'ms');
    controller.abort();
  }, timeoutMs);

  try {
    console.log('SidePanel: Making direct fetch request...');
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('SidePanel: Direct fetch completed with status:', response.status);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('SidePanel: Direct fetch failed:', err);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SubtitleError(
        `Request timed out after ${timeoutMs}ms`,
        'TIMEOUT',
        undefined,
        url
      );
    }
    throw new SubtitleError(
      `Network request failed: ${err instanceof Error ? err.message : 'Unknown error'}. Is the backend server running at http://127.0.0.1:8000?`,
      'NETWORK_ERROR',
      err instanceof Error ? err : undefined,
      url
    );
  }
}

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal?: AbortSignal): Promise<Response> {
  // Use background worker for Chrome extension context
  return fetchFromBackground(url, timeoutMs, externalSignal);
}

function getRetryDelay(attempt: number, baseDelay = RETRY_BASE_DELAY_MS, maxDelay = RETRY_MAX_DELAY_MS): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

function isRetryableError(error: SubtitleError): boolean {
  if (error.code === 'TIMEOUT') return true;
  if (error.code === 'NETWORK_ERROR') return true;
  if (error.code === 'SERVER_ERROR') return true;
  if (error.code === 'API_ERROR') {
    const statusCode = (error as SubtitleError & { statusCode?: number }).statusCode;
    return statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
  }
  return false;
}

async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  maxAttempts = RETRY_MAX_ATTEMPTS,
  onRetry?: (attempt: number, error: SubtitleError) => void,
  signal?: AbortSignal
): Promise<T> {
  let lastError: SubtitleError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check for cancellation before each attempt
    if (signal?.aborted) {
      throw new SubtitleError('Operation cancelled', 'NETWORK_ERROR', undefined);
    }

    try {
      return await fetchFn();
    } catch (err) {
      const subtitleError = err instanceof SubtitleError ? err : new SubtitleError(
        err instanceof Error ? err.message : 'Unknown error',
        'NETWORK_ERROR',
        err instanceof Error ? err : undefined
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
        signal?.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new SubtitleError('Operation cancelled', 'NETWORK_ERROR', undefined));
        }, { once: true });
      });
    }
  }

  throw lastError;
}

export async function fetchYoutubeSubtitles(
  youtubeUrl: string,
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    onRetry?: (attempt: number, error: SubtitleError) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ title: string; text: string }> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, maxRetries = RETRY_MAX_ATTEMPTS, onRetry, signal } = options;

  if (!isYouTubeUrl(youtubeUrl)) {
    throw new SubtitleError('Invalid YouTube URL', 'INVALID_URL', undefined, youtubeUrl);
  }

  const videoId = await extractVideoId(youtubeUrl);

  const cached = await getCachedSubtitle(videoId);
  if (cached) {
    return cached;
  }

  return fetchWithRetry(
    async () => {
      const normalizedUrl = normalizeYouTubeUrl(youtubeUrl);
      const apiUrl = getSubtitlesApiUrl(normalizedUrl);
      const response = await fetchWithTimeout(apiUrl, timeoutMs, signal);

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
        if (response.status === 400 || errorType === 'validation_error') {
          throw new SubtitleError(errorMessage, 'INVALID_URL', undefined, youtubeUrl);
        }
        if (response.status === 401 || errorType === 'unauthorized') {
          throw new SubtitleError('Unauthorized request', 'API_ERROR', undefined, youtubeUrl);
        }
        if (response.status === 403 || errorType === 'forbidden') {
          throw new SubtitleError('Access forbidden', 'API_ERROR', undefined, youtubeUrl);
        }
        if (response.status === 404 || errorType === 'download_failed' || errorType === 'not_found') {
          throw new SubtitleError(errorMessage, 'NO_SUBTITLES', undefined, youtubeUrl);
        }
        if (response.status === 429 || errorType === 'rate_limit_exceeded') {
          throw new SubtitleError('Rate limit exceeded', 'SERVER_ERROR', undefined, youtubeUrl);
        }
        if (response.status >= 500) {
          throw new SubtitleError(
            `Backend server error: ${response.status}`,
            'SERVER_ERROR',
            undefined,
            youtubeUrl
          );
        }

        throw new SubtitleError(errorMessage, 'API_ERROR', undefined, youtubeUrl);
      }

      let data: FastApiSubtitleResponse;
      try {
        data = await response.json();
      } catch (err) {
        throw new SubtitleError(
          'Failed to parse API response',
          'PARSE_ERROR',
          err instanceof Error ? err : undefined,
          youtubeUrl
        );
      }

      if (!data.text || data.text.trim().length === 0) {
        throw new SubtitleError('No subtitles found for this video', 'NO_SUBTITLES', undefined, youtubeUrl);
      }

      const text = data.text;
      const title = data.metadata.title;

      const result = { title, text };

      await setCachedSubtitle(videoId, result);

      return result;
    },
    maxRetries,
    onRetry,
    signal
  );
}