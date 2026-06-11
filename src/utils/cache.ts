import type { DomainGroup } from "../types";

export const CACHE_TTL = 30000;
const CACHE_KEY = "mimir_cached_tabs";

const CONTENT_CACHE_PREFIX = "content_";
const CONTENT_CACHE_TTL = 300000; // 5 minutes
const MAX_CONTENT_ENTRY_SIZE = 1.5 * 1024 * 1024; // 1.5MB per extracted tab entry

// Chrome storage.session has a 10MB limit. We use 9MB to stay safely under.
const MAX_CACHE_SIZE = 9 * 1024 * 1024; // 9MB in bytes

// DI-1: split the metadata store per kind.
//   - mimir_cache_metadata   tracks the tab-group blob (CACHE_KEY)
//   - mimir_content_metadata tracks per-tab content entries (content_<id>)
// Each kind gets its own read-modify-write cycle so a content write
// can no longer trample a tabs write (or vice versa).
const CACHE_METADATA_KEY = "mimir_cache_metadata";
const CONTENT_METADATA_KEY = "mimir_content_metadata";
type MetadataKey = typeof CACHE_METADATA_KEY | typeof CONTENT_METADATA_KEY;
function metadataKeyFor(key: string): MetadataKey {
	return key.startsWith(CONTENT_CACHE_PREFIX) ? CONTENT_METADATA_KEY : CACHE_METADATA_KEY;
}
// Read the content metadata blob. The router needs a real key, so
// use the content_<id> prefix to land on the right blob.
function getContentMetadata(): Promise<CacheMetadata> {
	return getCacheMetadata(`${CONTENT_CACHE_PREFIX}__probe`);
}

interface CacheEntry<T> {
	data: T;
	timestamp: number;
	size: number;
	accessCount: number;
	lastAccess: number;
}

interface CacheMetadata {
	// Track size and access info for each cache key
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
 * Approximates the size of a value in bytes when stored in chrome.storage.session
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
 * Loads cache metadata from storage. `key` decides which metadata blob
 * to read — pass a content_<id> key to read content metadata, pass
 * CACHE_KEY to read tab-group metadata. The no-arg form returns the
 * tab-group blob (preserves the previous call sites in
 * ensureCacheSpace/evictLRUEntry/rebuildMetadata).
 */
async function getCacheMetadata(key?: string): Promise<CacheMetadata> {
	const metadataKey: MetadataKey = key ? metadataKeyFor(key) : CACHE_METADATA_KEY;
	try {
		const cached = await chrome.storage.session.get([metadataKey]);
		return (cached[metadataKey] as CacheMetadata) || { entries: [], totalSize: 0 };
	} catch {
		return { entries: [], totalSize: 0 };
	}
}

/**
 * Saves cache metadata to storage. `key` decides which blob; without
 * one the tab-group blob is written.
 */
async function setCacheMetadata(metadata: CacheMetadata, key?: string): Promise<void> {
	const metadataKey: MetadataKey = key ? metadataKeyFor(key) : CACHE_METADATA_KEY;
	try {
		await chrome.storage.session.set({ [metadataKey]: metadata });
	} catch (err) {
		console.warn("Failed to save cache metadata:", err);
	}
}

/**
 * Updates metadata for a specific cache entry. Reads/writes the
 * per-kind metadata blob chosen by `key` so a tabs write and a
 * content write no longer share a snapshot.
 */
async function updateEntryMetadata(
	key: string,
	size: number,
	timestamp: number,
	isAccess: boolean = false,
): Promise<void> {
	const metadata = await getCacheMetadata(key);
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

	await setCacheMetadata(metadata, key);
}

/**
 * Removes metadata for a specific cache entry. Operates on the per-kind
 * blob chosen by `key` so a content removal cannot affect tabs.
 */
async function removeEntryMetadata(key: string): Promise<void> {
	const metadata = await getCacheMetadata(key);
	const index = metadata.entries.findIndex((e) => e.key === key);

	if (index >= 0) {
		const entry = metadata.entries[index];
		metadata.totalSize -= entry.size;
		metadata.entries.splice(index, 1);
		await setCacheMetadata(metadata, key);
	}
}

/**
 * Finds and removes the least recently used cache entry across BOTH
 * per-kind metadata blobs. Prioritises expired entries, then LRU.
 */
async function evictLRUEntry(): Promise<boolean> {
	const [cacheMeta, contentMeta] = await Promise.all([getCacheMetadata(CACHE_KEY), getContentMetadata()]);
	const all = [...cacheMeta.entries, ...contentMeta.entries];
	if (all.length === 0) return false;

	const now = Date.now();
	const isExpired = (e: CacheMetadata["entries"][number]) =>
		e.key.startsWith(CONTENT_CACHE_PREFIX) ? now - e.timestamp > CONTENT_CACHE_TTL : now - e.timestamp > CACHE_TTL;
	const expiredEntry = all.find(isExpired);
	const oldest = all.reduce(
		(best, e) =>
			e.lastAccess < best.lastAccess || (e.lastAccess === best.lastAccess && e.accessCount < best.accessCount)
				? e
				: best,
		all[0],
	);
	const entryToEvict = expiredEntry ?? oldest;

	try {
		await chrome.storage.session.remove([entryToEvict.key]);
		await removeEntryMetadata(entryToEvict.key);
		console.debug(`Evicted cache entry: ${entryToEvict.key} (${entryToEvict.size} bytes)`);
		return true;
	} catch (err) {
		console.warn(`Failed to evict cache entry ${entryToEvict.key}:`, err);
		return false;
	}
}

/**
 * Ensures there's enough space in the cache for a new entry. Sums
 * totalSize across both per-kind metadata blobs and evicts the oldest
 * LRU entry from whichever blob is over-quota.
 */
async function ensureCacheSpace(requiredSize: number): Promise<void> {
	const [a, b] = await Promise.all([getCacheMetadata(CACHE_KEY), getContentMetadata()]);
	let total = a.totalSize + b.totalSize;
	if (total + requiredSize <= MAX_CACHE_SIZE) return;

	const maxEvictions = 100;
	let evictions = 0;
	while (true) {
		const [ca, cb] = await Promise.all([getCacheMetadata(CACHE_KEY), getContentMetadata()]);
		total = ca.totalSize + cb.totalSize;
		if (total + requiredSize <= MAX_CACHE_SIZE || evictions >= maxEvictions) break;
		const evicted = await evictLRUEntry();
		if (!evicted) break;
		evictions++;
	}
	if (evictions > 0) console.debug(`Evicted ${evictions} cache entries to free up space`);
}

/**
 * Rebuilds metadata from actual storage contents. Walks all session
 * keys once, dispatches each entry to the right per-kind metadata
 * blob, and writes both blobs in one set call.
 */
async function rebuildMetadata(): Promise<void> {
	try {
		const all = await chrome.storage.session.get(null);
		const cacheEntries: CacheMetadata["entries"] = [];
		const contentEntries: CacheMetadata["entries"] = [];
		let cacheTotal = 0;
		let contentTotal = 0;
		const now = Date.now();

		for (const [key, value] of Object.entries(all)) {
			if (key === CACHE_METADATA_KEY || key === CONTENT_METADATA_KEY) continue;

			const size = calculateSize(value);
			let timestamp = now;
			let lastAccess = now;
			if (typeof value === "object" && value !== null && "timestamp" in value) {
				timestamp = (value as { timestamp: number }).timestamp;
				lastAccess = timestamp;
			}
			const row = { key, size, timestamp, lastAccess, accessCount: 1 };

			if (key === CACHE_KEY) {
				cacheEntries.push(row);
				cacheTotal += size;
			} else if (key.startsWith(CONTENT_CACHE_PREFIX)) {
				contentEntries.push(row);
				contentTotal += size;
			}
		}

		await chrome.storage.session.set({
			[CACHE_METADATA_KEY]: { entries: cacheEntries, totalSize: cacheTotal },
			[CONTENT_METADATA_KEY]: { entries: contentEntries, totalSize: contentTotal },
		});
		console.debug(
			`Rebuilt metadata: cache=${cacheEntries.length}/${cacheTotal}B, content=${contentEntries.length}/${contentTotal}B`,
		);
	} catch (err) {
		console.warn("Failed to rebuild metadata:", err);
	}
}

export async function getCachedTabs(): Promise<DomainGroup[] | null> {
	try {
		const cached = await chrome.storage.session.get([CACHE_KEY]);
		const entry = cached[CACHE_KEY] as CacheEntry<DomainGroup[]> | undefined;

		if (!entry) return null;

		// DI-1: validate the cached timestamp before trusting the entry.
		// A corrupted payload (timestamp: Number.MAX_SAFE_INTEGER, NaN,
		// negative, or a future date) used to slip past the simple
		// `now - timestamp > TTL` check and resurrect a stale entry.
		if (typeof entry.timestamp !== "number" || !Number.isFinite(entry.timestamp) || entry.timestamp < 0) {
			await chrome.storage.session.remove([CACHE_KEY]);
			await removeEntryMetadata(CACHE_KEY);
			return null;
		}

		const now = Date.now();
		if (entry.timestamp > now || now - entry.timestamp > CACHE_TTL) {
			await chrome.storage.session.remove([CACHE_KEY]);
			await removeEntryMetadata(CACHE_KEY);
			return null;
		}

		// Update access tracking
		await updateEntryMetadata(CACHE_KEY, entry.size, entry.timestamp, true);

		return entry.data;
	} catch (err) {
		console.warn("Failed to load tabs from cache:", err);
		return null;
	}
}

let cacheWriteLock: Promise<void> | null = null;
let contentCacheWriteLock: Promise<void> | null = null;

export async function setCachedTabs(data: DomainGroup[]): Promise<void> {
	// Wait for any existing write operation to complete before starting a new one
	// This prevents race conditions where multiple writes could trigger duplicate cleanup
	if (cacheWriteLock) {
		await cacheWriteLock;
	}

	// Create a new lock for this write operation
	cacheWriteLock = (async () => {
		try {
			const timestamp = Date.now();
			const entry: CacheEntry<DomainGroup[]> = {
				data,
				timestamp,
				size: 0, // Will be calculated below
				accessCount: 1,
				lastAccess: timestamp,
			};

			// Calculate the size of the new entry
			const entrySize = calculateSize(entry);
			entry.size = entrySize;

			// Ensure there's enough space before writing
			await ensureCacheSpace(entrySize);

			// Check if we're overwriting an existing entry. The metadata
			// blob is keyed by the entry's storage key (CACHE_KEY for the
			// tab-group blob), so this read-modify-write cannot see or
			// trample a concurrent setCachedContent call.
			const metadata = await getCacheMetadata(CACHE_KEY);
			const existingEntry = metadata.entries.find((e) => e.key === CACHE_KEY);
			if (existingEntry) {
				// Account for the size of the entry we're replacing
				metadata.totalSize -= existingEntry.size;
			}

			// LIF-3: write the cache entry. The error class from
			// chrome.storage.session is `QuotaExceededError` (a DOMException),
			// not a message string. Detect by name first; fall back to message
			// for older Chromium builds.
			const isQuotaError = (e: unknown): boolean => {
				if (e instanceof DOMException && e.name === "QuotaExceededError") return true;
				if (e instanceof Error && (e.message.includes("QUOTA") || e.message.includes("quota"))) return true;
				return false;
			};
			try {
				await chrome.storage.session.set({ [CACHE_KEY]: entry });
				// Update metadata after successful write
				await updateEntryMetadata(CACHE_KEY, entrySize, timestamp);
			} catch (setErr) {
				if (isQuotaError(setErr)) {
					console.warn("Storage quota exceeded, performing emergency eviction");

					// Rebuild metadata to ensure accuracy
					await rebuildMetadata();

					// Try evicting multiple entries
					for (let i = 0; i < 5; i++) {
						await evictLRUEntry();
					}

					// Retry write once
					try {
						await chrome.storage.session.set({ [CACHE_KEY]: entry });
						await updateEntryMetadata(CACHE_KEY, entrySize, timestamp);
					} catch (retryErr) {
						if (isQuotaError(retryErr)) {
							console.warn("Quota exceeded even after emergency eviction; dropping this write", retryErr);
						} else {
							throw retryErr;
						}
					}
				} else {
					throw setErr;
				}
			}
		} catch (err) {
			if (err instanceof Error && err.message.includes("QUOTA")) {
				console.warn("Quota exceeded while writing cache (after retry):", err);
			} else {
				console.warn("Failed to write cache:", err);
			}
		}
	})();

	// Wait for this write operation to complete before returning
	await cacheWriteLock;
}

export async function removeExpiredCache(): Promise<void> {
	try {
		const cached = await chrome.storage.session.get([CACHE_KEY]);
		const entry = cached[CACHE_KEY] as CacheEntry<DomainGroup[]> | undefined;

		if (entry && Date.now() - entry.timestamp > CACHE_TTL) {
			await chrome.storage.session.remove([CACHE_KEY]);
			await removeEntryMetadata(CACHE_KEY);
		}
	} catch (err) {
		console.warn("Failed to remove expired cache:", err);
	}
}

export function getCacheKey(): string {
	return CACHE_KEY;
}

export interface ExtractedContentEntry {
	text: string;
	title: string;
	url: string;
	timestamp: number;
	size: number;
	accessCount: number;
	lastAccess: number;
}

export async function getCachedContent(
	tabId: number,
	currentUrl?: string,
): Promise<{ text: string; title: string; url: string } | null> {
	try {
		const cacheKey = `${CONTENT_CACHE_PREFIX}${tabId}`;
		const cached = await chrome.storage.session.get([cacheKey]);
		const entry = cached[cacheKey] as ExtractedContentEntry | undefined;

		if (!entry) return null;

		const now = Date.now();

		// Check for expiration
		if (now - entry.timestamp > CONTENT_CACHE_TTL) {
			await chrome.storage.session.remove([cacheKey]);
			await removeEntryMetadata(cacheKey);
			return null;
		}

		// Bug 1.3: invalidate on URL change. If the tab navigated to a new URL
		// since we cached, the cached text/title are stale.
		if (currentUrl && entry.url && entry.url !== currentUrl) {
			await chrome.storage.session.remove([cacheKey]);
			await removeEntryMetadata(cacheKey);
			return null;
		}

		// Update access tracking
		await updateEntryMetadata(cacheKey, entry.size, entry.timestamp, true);

		return { text: entry.text, title: entry.title, url: entry.url };
	} catch (err) {
		console.warn("Failed to load content from cache:", err);
		return null;
	}
}

export async function setCachedContent(
	tabId: number,
	data: { text: string; title: string; url: string },
): Promise<void> {
	// Serialize concurrent writes so metadata read-modify-write is atomic.
	// Without this lock, two parallel extractions both read the same
	// metadata snapshot, both call setCacheMetadata, and the second call's
	// full-object write silently overwrites the first's entries — dropping
	// one of the rows and corrupting totalSize.
	if (contentCacheWriteLock) {
		await contentCacheWriteLock;
	}

	contentCacheWriteLock = (async () => {
		try {
			const cacheKey = `${CONTENT_CACHE_PREFIX}${tabId}`;
			const timestamp = Date.now();

			const entry: ExtractedContentEntry = {
				text: data.text,
				title: data.title,
				url: data.url,
				timestamp,
				size: 0, // Will be calculated below
				accessCount: 1,
				lastAccess: timestamp,
			};

			// Calculate the size of the new entry
			const entrySize = calculateSize(entry);
			entry.size = entrySize;

			if (entrySize > MAX_CONTENT_ENTRY_SIZE) {
				console.debug(
					`Skipping content cache for tab ${tabId}: entry ${entrySize} bytes exceeds per-entry limit ${MAX_CONTENT_ENTRY_SIZE}`,
				);
				return;
			}

			// Ensure there's enough space before writing
			await ensureCacheSpace(entrySize);

			// Check if we're overwriting an existing entry. Read the
			// per-kind metadata blob (CONTENT_METADATA_KEY) so this
			// read-modify-write cannot see or trample a concurrent
			// setCachedTabs call.
			const metadata = await getCacheMetadata(cacheKey);
			const existingEntry = metadata.entries.find((e) => e.key === cacheKey);
			if (existingEntry) {
				// Account for the size of the entry we're replacing
				metadata.totalSize -= existingEntry.size;
			}

			// Write the cache entry
			try {
				await chrome.storage.session.set({ [cacheKey]: entry });
				// Update metadata after successful write
				await updateEntryMetadata(cacheKey, entrySize, timestamp);
			} catch (setErr) {
				// If we still get a quota error, try emergency eviction
				if (setErr instanceof Error && (setErr.message.includes("QUOTA") || setErr.message.includes("quota"))) {
					console.warn("Storage quota exceeded, performing emergency eviction");

					// Bug 1.11: the entire emergency-eviction sequence MUST run under
					// `contentCacheWriteLock` (the outer lock set above). A second
					// concurrent setCachedContent would otherwise call
					// updateEntryMetadata against a stale metadata snapshot that
					// pre-dates rebuildMetadata() and corrupt totalSize. Re-acquire
					// the lock here as a no-op safety so future refactors cannot
					// accidentally split the critical section.
					if (contentCacheWriteLock) {
						await contentCacheWriteLock;
					}

					// Rebuild metadata to ensure accuracy
					await rebuildMetadata();

					// Try evicting multiple entries
					for (let i = 0; i < 5; i++) {
						await evictLRUEntry();
					}

					// Retry write
					await chrome.storage.session.set({ [cacheKey]: entry });
					await updateEntryMetadata(cacheKey, entrySize, timestamp);
				} else {
					throw setErr;
				}
			}
		} catch (err) {
			if (err instanceof Error && err.message.includes("QUOTA")) {
				console.warn("Quota exceeded while writing content cache (after retry):", err);
			} else {
				console.warn("Failed to write content cache:", err);
			}
		}
	})();

	await contentCacheWriteLock;
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
					await removeEntryMetadata(key);
				}
			}
		}
	} catch (err) {
		console.warn("Failed to remove expired content cache:", err);
	}
}

/**
 * Clears all cache entries and metadata
 * Useful for testing or manual cache clearing
 */
export async function clearAllCache(): Promise<void> {
	try {
		const all = await chrome.storage.session.get(null);
		const keysToRemove = Object.keys(all).filter(
			(key) =>
				key === CACHE_KEY ||
				key.startsWith(CONTENT_CACHE_PREFIX) ||
				key === CACHE_METADATA_KEY ||
				key === CONTENT_METADATA_KEY,
		);
		await chrome.storage.session.remove(keysToRemove);
		console.debug(`Cleared ${keysToRemove.length} cache entries`);
	} catch (err) {
		console.warn("Failed to clear cache:", err);
	}
}

/**
 * Gets cache statistics for debugging/monitoring. Combines both
 * per-kind metadata blobs into a single view.
 */
export async function getCacheStats(): Promise<{
	totalSize: number;
	entryCount: number;
	maxSize: number;
	entries: Array<{
		key: string;
		size: number;
		lastAccess: number;
		accessCount: number;
		isExpired: boolean;
	}>;
}> {
	const [cacheMeta, contentMeta] = await Promise.all([getCacheMetadata(CACHE_KEY), getContentMetadata()]);
	const merged = [...cacheMeta.entries, ...contentMeta.entries];
	const now = Date.now();
	return {
		totalSize: cacheMeta.totalSize + contentMeta.totalSize,
		entryCount: merged.length,
		maxSize: MAX_CACHE_SIZE,
		entries: merged.map((e) => ({
			key: e.key,
			size: e.size,
			lastAccess: e.lastAccess,
			accessCount: e.accessCount,
			isExpired: e.key.startsWith(CONTENT_CACHE_PREFIX)
				? now - e.timestamp > CONTENT_CACHE_TTL
				: now - e.timestamp > CACHE_TTL,
		})),
	};
}

// PERF-5: debounced variant of setCachedTabs. Coalesces calls that
// arrive within DEBOUNCE_MS of each other and writes the most recent
// payload. Use this for high-frequency call sites (e.g. drag-reorder)
// where the intermediate states are not observable.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingData: DomainGroup[] | null = null;
const DEBOUNCE_MS = 250;

export function setCachedTabsDebounced(data: DomainGroup[]): void {
	pendingData = data;
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		if (pendingData) {
			void setCachedTabs(pendingData);
		}
		pendingData = null;
		debounceTimer = null;
	}, DEBOUNCE_MS);
}
