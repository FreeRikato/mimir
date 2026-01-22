import type { DomainGroup } from '../types';

export const CACHE_TTL = 30000;
const CACHE_KEY = 'mimir_cached_tabs';
const QUOTA_LIMIT = 1048576;

const CONTENT_CACHE_PREFIX = 'content_';
const CONTENT_CACHE_TTL = 300000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export async function getCachedTabs(): Promise<DomainGroup[] | null> {
  try {
    const cached = await chrome.storage.session.get([CACHE_KEY]);
    const entry = cached[CACHE_KEY] as CacheEntry<DomainGroup[]> | undefined;

    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL) {
      await chrome.storage.session.remove([CACHE_KEY]);
      return null;
    }

    return entry.data;
  } catch (err) {
    console.warn('Failed to load tabs from cache:', err);
    return null;
  }
}

export async function setCachedTabs(data: DomainGroup[]): Promise<void> {
  try {
    const entry: CacheEntry<DomainGroup[]> = {
      data,
      timestamp: Date.now(),
    };

    const totalBytes = await chrome.storage.session.getBytesInUse(null);
    const estimatedSize = new Blob([JSON.stringify({ [CACHE_KEY]: entry })]).size;

    if (totalBytes + estimatedSize >= QUOTA_LIMIT) {
      console.warn('Storage quota would be exceeded, skipping cache write');
      return;
    }

    await chrome.storage.session.set({ [CACHE_KEY]: entry });
  } catch (err) {
    if (err instanceof Error && err.message.includes('QUOTA')) {
      console.warn('Quota exceeded while writing cache:', err);
    } else {
      console.warn('Failed to write cache:', err);
    }
  }
}

export async function removeExpiredCache(): Promise<void> {
  try {
    const cached = await chrome.storage.session.get([CACHE_KEY]);
    const entry = cached[CACHE_KEY] as CacheEntry<DomainGroup[]> | undefined;

    if (entry && Date.now() - entry.timestamp > CACHE_TTL) {
      await chrome.storage.session.remove([CACHE_KEY]);
    }
  } catch (err) {
    console.warn('Failed to remove expired cache:', err);
  }
}

export function getCacheKey(): string {
  return CACHE_KEY;
}

interface ExtractedContentEntry {
  text: string;
  title: string;
  url: string;
  timestamp: number;
}

export async function getCachedContent(tabId: number): Promise<{ text: string; title: string; url: string } | null> {
  try {
    const cacheKey = `${CONTENT_CACHE_PREFIX}${tabId}`;
    const cached = await chrome.storage.session.get([cacheKey]);
    const entry = cached[cacheKey] as ExtractedContentEntry | undefined;

    if (!entry) return null;

    if (Date.now() - entry.timestamp > CONTENT_CACHE_TTL) {
      await chrome.storage.session.remove([cacheKey]);
      return null;
    }

    return { text: entry.text, title: entry.title, url: entry.url };
  } catch (err) {
    console.warn('Failed to load content from cache:', err);
    return null;
  }
}

export async function setCachedContent(tabId: number, data: { text: string; title: string; url: string }): Promise<void> {
  try {
    const cacheKey = `${CONTENT_CACHE_PREFIX}${tabId}`;
    const entry: ExtractedContentEntry = {
      text: data.text,
      title: data.title,
      url: data.url,
      timestamp: Date.now(),
    };

    const totalBytes = await chrome.storage.session.getBytesInUse(null);
    const estimatedSize = new Blob([JSON.stringify({ [cacheKey]: entry })]).size;

    if (totalBytes + estimatedSize >= QUOTA_LIMIT) {
      console.warn('Storage quota would be exceeded, skipping content cache write');
      return;
    }

    await chrome.storage.session.set({ [cacheKey]: entry });
  } catch (err) {
    if (err instanceof Error && err.message.includes('QUOTA')) {
      console.warn('Quota exceeded while writing content cache:', err);
    } else {
      console.warn('Failed to write content cache:', err);
    }
  }
}

export async function removeExpiredContentCache(): Promise<void> {
  try {
    const all = await chrome.storage.session.get(null);
    const now = Date.now();

    for (const [key, entry] of Object.entries(all)) {
      if (key.startsWith(CONTENT_CACHE_PREFIX)) {
        const cacheEntry = entry as ExtractedContentEntry | undefined;
        if (cacheEntry && now - cacheEntry.timestamp > CONTENT_CACHE_TTL) {
          await chrome.storage.session.remove([key]);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to remove expired content cache:', err);
  }
}
