/**
 * Cache entry shape stored in `chrome.storage.session` for a single tab's
 * extracted content. Mirrored from `cache.ts` (which keeps the same struct
 * private) so the URL-invalidation helper can be unit-tested in node.
 */

export interface ContentCacheEntry {
	text: string;
	title: string;
	url: string;
	timestamp: number;
	size: number;
	accessCount: number;
	lastAccess: number;
}

export const CONTENT_CACHE_TTL_MS = 300_000; // 5 minutes, matches cache.ts

/**
 * Decide whether a cached entry is still valid for the *current* tab URL.
 *
 * Bug 1.3 (getCachedContent always serves from cache, never invalidates on URL change):
 *   When a tab navigates to a new URL but keeps the same tabId, the cached
 *   entry's URL no longer matches the live tab. The old behavior returned the
 *   stale text and title. The new behavior compares the cache's stored URL to
 *   the current tab URL and treats a mismatch as a cache miss.
 */
export function isContentCacheValid(entry: ContentCacheEntry, currentUrl: string, now: number = Date.now()): boolean {
	if (!currentUrl) return false;
	if (entry.url !== currentUrl) return false;
	if (now - entry.timestamp > CONTENT_CACHE_TTL_MS) return false;
	return true;
}
