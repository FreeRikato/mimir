/**
 * Bounded LRU store for the MAIN-world X/Twitter cache (`window.__mimiXData`).
 *
 * Bug fixes:
 *   - MEM-1: the previous implementation was an unbounded `Record<string, unknown>`
 *     that grew by one full GraphQL payload per unique focalTweetId. A 30-minute
 *     deep-dive thread session could accumulate hundreds of MB.
 *   - MEM-2: the store survived SPA navigations; 20 client-side route changes
 *     meant 20 different threads' payloads in memory.
 *
 * The fix:
 *   - Cap at {@link MAX_X_DATA_ENTRIES} (50) entries with strict LRU eviction.
 *   - `get()` promotes the entry to most-recently-used so an actively-read
 *     tweet is the last to be evicted.
 *   - `clear()` empties the store; the caller (the content script) invokes
 *     it on `popstate` / SPA `pushState` replacements to drop stale threads.
 *   - `dispose()` releases internal references for clean tear-down.
 *
 * Pure logic, no DOM, no globals — fully unit-testable in node.
 */

export const MAX_X_DATA_ENTRIES = 50;

export interface XDataStore {
	/**
	 * Insert or update an entry. Evicts the LRU entry if the cap is
	 * exceeded. The optional `onEvict` callback is fired once per key
	 * that the store drops to make room — the content script uses it
	 * to keep the `window.__mimiXData` mirror in sync with the LRU
	 * (MEM-2 follow-up).
	 */
	set(id: string, data: unknown, onEvict?: (id: string) => void): void;
	/** Read an entry. Promotes it to most-recently-used. */
	get(id: string): unknown | undefined;
	/** Whether the id is currently held. Does NOT touch LRU order. */
	has(id: string): boolean;
	/** Drop every entry. Use on SPA navigation (MEM-2). */
	clear(): void;
	/** Current number of entries. */
	size(): number;
	/**
	 * Ids currently held, in MRU-first order (most-recently-used first).
	 * The first element is the last entry that was set or read; the last
	 * element is the next to be evicted.
	 */
	keys(): string[];
	/** Drop everything and prevent further writes. */
	dispose(): void;
}

export function createXDataStore(maxEntries: number = MAX_X_DATA_ENTRIES): XDataStore {
	if (!Number.isInteger(maxEntries) || maxEntries < 1) {
		throw new RangeError(`maxEntries must be a positive integer, got ${maxEntries}`);
	}

	// Map preserves insertion / access order. We insert most-recently-used at
	// the END so the LRU entry is always `entries.keys().next().value`.
	const entries = new Map<string, unknown>();
	let disposed = false;

	const promote = (id: string): unknown | undefined => {
		const value = entries.get(id);
		if (value === undefined) return undefined;
		// Re-insert to move the key to the end (most-recently-used).
		entries.delete(id);
		entries.set(id, value);
		return value;
	};

	const evictIfOver = (onEvict?: (id: string) => void): void => {
		while (entries.size > maxEntries) {
			// Map iteration is insertion order — the first key is the LRU entry.
			const oldest = entries.keys().next().value;
			if (oldest === undefined) break;
			entries.delete(oldest);
			// MEM-2 follow-up: notify callers so they can drop their
			// mirror copies (e.g. `window.__mimiXData`). The callback is
			// wrapped in try/catch so a throw cannot break the eviction
			// loop or leak the entry.
			if (onEvict) {
				try {
					onEvict(oldest);
				} catch {
					// swallow — eviction must continue
				}
			}
		}
	};

	return {
		set(id, data, onEvict) {
			if (disposed) return;
			// Treat undefined as a delete so callers can pass `undefined` to evict.
			if (data === undefined) {
				entries.delete(id);
				return;
			}
			// If the id is already present, delete first so re-insert moves it
			// to MRU position.
			if (entries.has(id)) entries.delete(id);
			entries.set(id, data);
			evictIfOver(onEvict);
		},
		get(id) {
			if (disposed) return undefined;
			return promote(id);
		},
		has(id) {
			return entries.has(id);
		},
		clear() {
			entries.clear();
		},
		size() {
			return entries.size;
		},
		keys() {
			// Return MRU-first: reverse Map's insertion order (oldest -> MRU).
			return Array.from(entries.keys()).reverse();
		},
		dispose() {
			entries.clear();
			disposed = true;
		},
	};
}
