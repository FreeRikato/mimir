import type { SubtitlesResponse } from '../types';
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
  const baseUrl = SUBTITLES_BASE_URL || 'https://ytdp-nodejs.onrender.com';
  const apiEndpoint = `${baseUrl}/api/subtitles`;
  return `${apiEndpoint}?url=${youtubeUrl}`;
}

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  controller.signal.addEventListener('abort', () => clearTimeout(timeoutId));

  return controller;
}

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal?: AbortSignal): Promise<Response> {
  const controller = createTimeoutController(timeoutMs);

  // Combine timeout signal with external abort signal if provided
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;

  try {
    const response = await fetch(url, { signal });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Check if it was external cancellation or timeout
      if (externalSignal?.aborted) {
        throw new SubtitleError('Operation cancelled', 'NETWORK_ERROR', undefined, url);
      }
      throw new SubtitleError(
        `Request timed out after ${timeoutMs}ms`,
        'TIMEOUT',
        undefined,
        url
      );
    }
    throw new SubtitleError(
      'Network request failed',
      'NETWORK_ERROR',
      err instanceof Error ? err : undefined,
      url
    );
  }
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

function cleanSubtitleText(subtitles: string[]): string {
  const cleanedLines: string[] = [];
  const seenLines = new Set<string>();

  for (const line of subtitles) {
    const noTimestamp = line.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '');
    const noTags = noTimestamp.replace(/<\/?[a-zA-Z0-9_]+>/g, '');
    const noMetadata = noTags.replace(/^(Kind:|Language:).*/gm, '');
    const trimmed = noMetadata.trim();

    if (trimmed && !seenLines.has(trimmed)) {
      seenLines.add(trimmed);
      cleanedLines.push(trimmed);
    }
  }

  return cleanedLines.join('\n');
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
        if (response.status >= 500) {
          throw new SubtitleError(
            `Backend server error: ${response.status}`,
            'SERVER_ERROR',
            undefined,
            youtubeUrl
          );
        }

        let apiMessage: string | undefined;
        try {
          const errorBody = await response.json();
          apiMessage = errorBody.error || errorBody.message || errorBody.detail;
        } catch {
          // Ignore JSON parse errors
        }

        const message = apiMessage ? `API request failed: ${response.status} - ${apiMessage}` : `API request failed: ${response.status}`;
        throw new SubtitleError(message, 'API_ERROR', undefined, youtubeUrl);
      }

      let data: SubtitlesResponse;
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

      if (!data.success) {
        const errorMessage = data.error || data.detail || 'Subtitles API returned unsuccessful response';
        if (errorMessage.includes('no subtitles') || errorMessage.includes('caption')) {
          throw new SubtitleError(errorMessage, 'NO_SUBTITLES', undefined, youtubeUrl);
        }
        throw new SubtitleError(errorMessage, 'API_ERROR', undefined, youtubeUrl);
      }

      if (!data.subtitles || data.subtitles.length === 0) {
        throw new SubtitleError('No subtitles found for this video', 'NO_SUBTITLES', undefined, youtubeUrl);
      }

      const text = cleanSubtitleText(data.subtitles);
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