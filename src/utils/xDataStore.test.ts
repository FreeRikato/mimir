/**
 * Characterization tests for MEM-1 (unbounded __mimiXData) and MEM-2
 * (cache not invalidated on SPA navigation).
 *
 * Contract under test:
 *   - set(id, data) caps the store at MAX_X_DATA_ENTRIES (50) and evicts
 *     the least-recently-used entry when the cap is exceeded.
 *   - get(id) promotes the entry to most-recently-used so it survives
 *     a subsequent set that crosses the cap.
 *   - clear() empties the store, mimicking a SPA navigation reset.
 *   - size() and keys() expose observability for tests and metrics.
 *   - The store never holds more than MAX_X_DATA_ENTRIES entries,
 *     regardless of how many distinct ids are written.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createXDataStore, MAX_X_DATA_ENTRIES, type XDataStore } from "./xDataStore";

const sample = (id: string) => ({ id, payload: { entries: [`entry-${id}`] } });

describe("XDataStore (MEM-1: LRU cap)", () => {
	let store: XDataStore;

	afterEach(() => {
		store.dispose();
	});

	it("caps the store at MAX_X_DATA_ENTRIES (50) and evicts the least-recently-used", () => {
		store = createXDataStore();

		// Write 60 distinct entries — the first 10 must be evicted.
		for (let i = 0; i < MAX_X_DATA_ENTRIES + 10; i++) {
			store.set(`tweet-${i}`, sample(`tweet-${i}`));
		}

		expect(store.size()).toBe(MAX_X_DATA_ENTRIES);

		// The first 10 ids were the oldest; they must be gone.
		for (let i = 0; i < 10; i++) {
			expect(store.has(`tweet-${i}`)).toBe(false);
		}
		// The most recent 50 must still be there.
		for (let i = 10; i < MAX_X_DATA_ENTRIES + 10; i++) {
			expect(store.has(`tweet-${i}`)).toBe(true);
		}
	});

	it("promotes an entry to most-recently-used on get() so it survives a future eviction", () => {
		store = createXDataStore();

		// Fill to cap with ids 0..49.
		for (let i = 0; i < MAX_X_DATA_ENTRIES; i++) {
			store.set(`tweet-${i}`, sample(`tweet-${i}`));
		}

		// Touch "tweet-0" — it becomes most-recently-used.
		expect(store.get("tweet-0")).toEqual(sample("tweet-0"));

		// Now write enough new entries to force one eviction.
		// After promotion, "tweet-1" is the LRU entry, so it should be evicted.
		store.set("tweet-new", sample("tweet-new"));

		expect(store.has("tweet-0")).toBe(true);
		expect(store.has("tweet-1")).toBe(false);
		expect(store.has("tweet-new")).toBe(true);
	});

	it("clear() empties the entire store (MEM-2: SPA navigation reset)", () => {
		store = createXDataStore();

		for (let i = 0; i < 5; i++) {
			store.set(`tweet-${i}`, sample(`tweet-${i}`));
		}
		expect(store.size()).toBe(5);

		store.clear();
		expect(store.size()).toBe(0);
		expect(store.has("tweet-0")).toBe(false);
	});

	it("dispose() releases internal refs and makes the store inert", () => {
		store = createXDataStore();
		store.set("tweet-0", sample("tweet-0"));
		store.dispose();
		expect(store.size()).toBe(0);
		// Set after dispose is a no-op (no throw, no entry).
		store.set("tweet-1", sample("tweet-1"));
		expect(store.size()).toBe(0);
	});

	it("keys() returns the ids currently held, in MRU-first order", () => {
		store = createXDataStore();
		store.set("a", sample("a"));
		store.set("b", sample("b"));
		store.set("c", sample("c"));
		store.get("a"); // promote a

		expect(store.keys()).toEqual(["a", "c", "b"]);
	});

	it("MAX_X_DATA_ENTRIES is exactly 50", () => {
		// Pin the constant so a future drift is caught by a build-time review.
		expect(MAX_X_DATA_ENTRIES).toBe(50);
	});
});

// MEM-2 follow-up: the xTwitter content script mirrors store writes
// into `window.__mimiXData[id]`. The store evicts the LRU key when
// the cap is exceeded, but the mirror used to be silently orphaned —
// `w.__mimiXData` could hold MORE entries than the store. The fix
// adds an onEvict hook the script can use to delete the orphaned
// mirror keys at the same time the store drops them.
describe("XDataStore (MEM-2 follow-up: onEvict hook)", () => {
	it("invokes onEvict(id) when the LRU entry is dropped because the cap was exceeded", () => {
		const evicted: string[] = [];
		const store = createXDataStore(3);
		store.set("a", 1);
		store.set("b", 2);
		store.set("c", 3);
		// Force one eviction: the 4th distinct key kicks out "a".
		store.set("d", 4, (id) => evicted.push(id));
		expect(evicted).toEqual(["a"]);
		expect(store.has("a")).toBe(false);
	});

	it("invokes onEvict(id) on every over-cap eviction in a burst write", () => {
		const evicted: string[] = [];
		const store = createXDataStore(2);
		store.set("a", 1);
		store.set("b", 2);
		store.set("c", 3, (id) => evicted.push(id));
		store.set("d", 4, (id) => evicted.push(id));
		store.set("e", 5, (id) => evicted.push(id));
		expect(evicted).toEqual(["a", "b", "c"]);
		expect(store.size()).toBe(2);
	});

	it("does NOT invoke onEvict when an existing id is re-set (LRU update, no eviction)", () => {
		const evicted: string[] = [];
		const store = createXDataStore(2);
		store.set("a", 1);
		store.set("b", 2);
		store.set("a", 11, (id) => evicted.push(id));
		expect(evicted).toEqual([]);
		expect(store.size()).toBe(2);
	});

	it("omitting the onEvict hook is a no-op (existing callers are not affected)", () => {
		const store = createXDataStore(2);
		store.set("a", 1);
		store.set("b", 2);
		// No throw, no eviction callback needed.
		store.set("c", 3);
		expect(store.has("a")).toBe(false);
	});
});
