import type { SubtitlesResponse } from '../types';
import { SubtitleError } from '../types';
import { isYouTubeUrl, normalizeYouTubeUrl } from './youtube';

const SUBTITLES_BASE_URL = import.meta.env.VITE_SUBTITLES_BASE_URL ?? '';

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 100000;

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

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = createTimeoutController(timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
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
  onRetry?: (attempt: number, error: SubtitleError) => void
): Promise<T> {
  let lastError: SubtitleError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      await new Promise(resolve => setTimeout(resolve, delay));
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
  } = {}
): Promise<{ title: string; text: string }> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, maxRetries = RETRY_MAX_ATTEMPTS, onRetry } = options;

  if (!isYouTubeUrl(youtubeUrl)) {
    throw new SubtitleError('Invalid YouTube URL', 'INVALID_URL', undefined, youtubeUrl);
  }

  return fetchWithRetry(
    async () => {
      // Normalize URL to ensure API compatibility (e.g., youtu.be -> youtube.com)
      const normalizedUrl = normalizeYouTubeUrl(youtubeUrl);
      const apiUrl = getSubtitlesApiUrl(normalizedUrl);
      const response = await fetchWithTimeout(apiUrl, timeoutMs);

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
          // Ignore parse errors
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

      return { title, text };
    },
    maxRetries,
    onRetry
  );
}