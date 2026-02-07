import type { DomainGroup } from "../types";

export const CACHE_TTL = 30000;
const CACHE_KEY = "mimir_cached_tabs";

const CONTENT_CACHE_PREFIX = "content_";
const CONTENT_CACHE_TTL = 300000; // 5 minutes
const MAX_CONTENT_ENTRY_SIZE = 1.5 * 1024 * 1024; // 1.5MB per extracted tab entry

// Chrome storage.session has a 10MB limit. We use 9MB to stay safely under.
const MAX_CACHE_SIZE = 9 * 1024 * 1024; // 9MB in bytes

// Metadata key for tracking cache entries and their sizes
const CACHE_METADATA_KEY = "mimir_cache_metadata";

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
 * Loads cache metadata from storage
 */
async function getCacheMetadata(): Promise<CacheMetadata> {
	try {
		const cached = await chrome.storage.session.get([CACHE_METADATA_KEY]);
		return (cached[CACHE_METADATA_KEY] as CacheMetadata) || { entries: [], totalSize: 0 };
	} catch {
		return { entries: [], totalSize: 0 };
	}
}

/**
 * Saves cache metadata to storage
 */
async function setCacheMetadata(metadata: CacheMetadata): Promise<void> {
	try {
		await chrome.storage.session.set({ [CACHE_METADATA_KEY]: metadata });
	} catch (err) {
		console.warn("Failed to save cache metadata:", err);
	}
}

/**
 * Updates metadata for a specific cache entry
 */
async function updateEntryMetadata(
	key: string,
	size: number,
	timestamp: number,
	isAccess: boolean = false,
): Promise<void> {
	const metadata = await getCacheMetadata();
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

	await setCacheMetadata(metadata);
}

/**
 * Removes metadata for a specific cache entry
 */
async function removeEntryMetadata(key: string): Promise<void> {
	const metadata = await getCacheMetadata();
	const index = metadata.entries.findIndex((e) => e.key === key);

	if (index >= 0) {
		const entry = metadata.entries[index];
		metadata.totalSize -= entry.size;
		metadata.entries.splice(index, 1);
		await setCacheMetadata(metadata);
	}
}

/**
 * Finds and removes the least recently used cache entry
 * Prioritizes expired entries first, then uses LRU
 */
async function evictLRUEntry(): Promise<boolean> {
	const metadata = await getCacheMetadata();
	if (metadata.entries.length === 0) {
		return false;
	}

	const now = Date.now();

	// First, try to find expired entries
	const expiredEntry = metadata.entries.find((e) =>
		e.key.startsWith(CONTENT_CACHE_PREFIX) ? now - e.timestamp > CONTENT_CACHE_TTL : now - e.timestamp > CACHE_TTL,
	);

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
 * Ensures there's enough space in the cache for a new entry
 * Evicts LRU entries until there's sufficient space
 */
async function ensureCacheSpace(requiredSize: number): Promise<void> {
	const metadata = await getCacheMetadata();

	// Check if we need to evict entries
	if (metadata.totalSize + requiredSize <= MAX_CACHE_SIZE) {
		return; // Enough space available
	}

	const maxEvictions = 100; // Safety limit to prevent infinite loops
	let evictions = 0;

	while ((await getCacheMetadata()).totalSize + requiredSize > MAX_CACHE_SIZE && evictions < maxEvictions) {
		const evicted = await evictLRUEntry();
		if (!evicted) {
			// Couldn't evict more entries (cache is empty or failed)
			break;
		}
		evictions++;
	}

	if (evictions > 0) {
		console.debug(`Evicted ${evictions} cache entries to free up space`);
	}
}

/**
 * Rebuilds metadata from actual storage contents
 * Useful as a fallback if metadata becomes corrupted or out of sync
 */
async function rebuildMetadata(): Promise<void> {
	try {
		const all = await chrome.storage.session.get(null);
		const entries: CacheMetadata["entries"] = [];
		let totalSize = 0;
		const now = Date.now();

		for (const [key, value] of Object.entries(all)) {
			// Skip metadata key itself
			if (key === CACHE_METADATA_KEY) continue;

			const size = calculateSize(value);

			// Try to extract timestamp from cached entries
			let timestamp = now;
			let lastAccess = now;
			const accessCount = 1;

			if (typeof value === "object" && value !== null && "timestamp" in value) {
				timestamp = (value as { timestamp: number }).timestamp;
				lastAccess = timestamp;
			}

			entries.push({
				key,
				size,
				timestamp,
				lastAccess,
				accessCount,
			});
			totalSize += size;
		}

		await setCacheMetadata({ entries, totalSize });
		console.debug(`Rebuilt metadata: ${entries.length} entries, ${totalSize} bytes`);
	} catch (err) {
		console.warn("Failed to rebuild metadata:", err);
	}
}

export async function getCachedTabs(): Promise<DomainGroup[] | null> {
	try {
		const cached = await chrome.storage.session.get([CACHE_KEY]);
		const entry = cached[CACHE_KEY] as CacheEntry<DomainGroup[]> | undefined;

		if (!entry) return null;

		const now = Date.now();

		// Check for expiration
		if (now - entry.timestamp > CACHE_TTL) {
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

			// Check if we're overwriting an existing entry
			const metadata = await getCacheMetadata();
			const existingEntry = metadata.entries.find((e) => e.key === CACHE_KEY);
			if (existingEntry) {
				// Account for the size of the entry we're replacing
				metadata.totalSize -= existingEntry.size;
			}

			// Write the cache entry
			try {
				await chrome.storage.session.set({ [CACHE_KEY]: entry });
				// Update metadata after successful write
				await updateEntryMetadata(CACHE_KEY, entrySize, timestamp);
			} catch (setErr) {
				// If we still get a quota error, try emergency eviction
				if (setErr instanceof Error && (setErr.message.includes("QUOTA") || setErr.message.includes("quota"))) {
					console.warn("Storage quota exceeded, performing emergency eviction");

					// Rebuild metadata to ensure accuracy
					await rebuildMetadata();

					// Try evicting multiple entries
					for (let i = 0; i < 5; i++) {
						await evictLRUEntry();
					}

					// Retry write
					await chrome.storage.session.set({ [CACHE_KEY]: entry });
					await updateEntryMetadata(CACHE_KEY, entrySize, timestamp);
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

interface ExtractedContentEntry {
	text: string;
	title: string;
	url: string;
	timestamp: number;
	size: number;
	accessCount: number;
	lastAccess: number;
}

export async function getCachedContent(tabId: number): Promise<{ text: string; title: string; url: string } | null> {
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

		// Check if we're overwriting an existing entry
		const metadata = await getCacheMetadata();
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
			(key) => key === CACHE_KEY || key.startsWith(CONTENT_CACHE_PREFIX) || key === CACHE_METADATA_KEY,
		);
		await chrome.storage.session.remove(keysToRemove);
		console.debug(`Cleared ${keysToRemove.length} cache entries`);
	} catch (err) {
		console.warn("Failed to clear cache:", err);
	}
}

/**
 * Gets cache statistics for debugging/monitoring
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
	const metadata = await getCacheMetadata();
	const now = Date.now();

	return {
		totalSize: metadata.totalSize,
		entryCount: metadata.entries.length,
		maxSize: MAX_CACHE_SIZE,
		entries: metadata.entries.map((e) => ({
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
