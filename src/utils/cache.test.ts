/**
 * Characterization test for bug 1.5: `setCachedContent` lacks the same
 * module-level write lock that `setCachedTabs` uses, so two parallel
 * extractions finishing at once both compute `metadata.totalSize += entrySize`
 * on the same snapshot, double-counting. The 9MB cap becomes unreliable.
 *
 * Contract under test:
 *   - Two concurrent `setCachedContent` calls for different tab IDs each
 *     contribute their size exactly once to `metadata.totalSize`.
 *   - A second concurrent call for the SAME key does not create a duplicate
 *     metadata entry (last write wins, the metadata row is updated, not
 *     appended).
 *   - Writes are serialized by a module-level lock: the second call's read
 *     of metadata happens after the first call's write completes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface StorageArea {
	store: Record<string, unknown>;
	reset(): void;
	get: (keys: string[] | null) => Promise<Record<string, unknown>>;
	set: (items: Record<string, unknown>) => Promise<void>;
	remove: (keys: string | string[]) => Promise<void>;
}

function makeStorage(): StorageArea {
	// Closure-backed store so `get`/`set`/`remove` always see the latest state
	// even if a test swaps `store` references.
	let store: Record<string, unknown> = {};
	const obj: StorageArea = {
		store,
		get: vi.fn(async (keys: string[] | null) => {
			if (keys === null) return { ...store };
			const out: Record<string, unknown> = {};
			for (const k of keys) if (k in store) out[k] = store[k];
			return out;
		}),
		set: vi.fn(async (items: Record<string, unknown>) => {
			// Small async delay so concurrent calls actually interleave.
			await new Promise((r) => setTimeout(r, 5));
			Object.assign(store, items);
		}),
		remove: vi.fn(async (keys: string | string[]) => {
			const arr = Array.isArray(keys) ? keys : [keys];
			for (const k of arr) delete store[k];
		}),
		reset: () => {
			store = {};
			obj.store = store;
		},
	};
	return obj;
}

const session = makeStorage();

beforeEach(() => {
	session.reset();
	(globalThis as unknown as { chrome: { storage: { session: StorageArea } } }).chrome = {
		storage: { session },
	};
	vi.mocked(session.get).mockClear();
	vi.mocked(session.set).mockClear();
	vi.mocked(session.remove).mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function loadModule() {
	vi.resetModules();
	return import("./cache");
}

describe("setCachedContent (bug 1.5: write lock)", () => {
	it("two parallel setCachedContent calls for different tab IDs each add to totalSize exactly once", async () => {
		const { setCachedContent, getCacheStats } = await loadModule();

		const payload = (id: number) => ({
			text: "x".repeat(2_500),
			title: `tab-${id}`,
			url: `https://example.com/${id}`,
		});

		await Promise.all([setCachedContent(1, payload(1)), setCachedContent(2, payload(2))]);

		const stats = await getCacheStats();
		expect(stats.entryCount).toBe(2);
		// Each payload JSON ~ 2.5 KB → UTF-16 ~ 5 KB. Two entries ~ 10 KB.
		// With the bug, totalSize would be ~20 KB (double-counted).
		expect(stats.totalSize).toBeLessThan(15_000);
		expect(stats.totalSize).toBeGreaterThan(3_000);
	});

	it("two parallel setCachedContent calls for the SAME tab id produce one metadata row", async () => {
		const { setCachedContent, getCacheStats } = await loadModule();

		const a = { text: "a", title: "A", url: "https://a" };
		const b = { text: "b".repeat(1_000), title: "B", url: "https://b" };

		await Promise.all([setCachedContent(99, a), setCachedContent(99, b)]);

		const stats = await getCacheStats();
		expect(stats.entryCount).toBe(1);
		expect(stats.entries[0].key).toBe("content_99");
		// B's payload is larger; metadata.totalSize should reflect B (or
		// whichever wrote last) — not A + B.
		expect(stats.totalSize).toBeLessThan(8_000);
	});

	it("serializes calls — writes do not interleave metadata updates", async () => {
		const { setCachedContent, getCacheStats } = await loadModule();

		// Use a slow `set` to make interleaving visible.
		vi.mocked(session.set).mockImplementation(async (items) => {
			await new Promise((r) => setTimeout(r, 10));
			const k = Object.keys(items)[0];
			if (k && k !== "mimir_cache_metadata") {
				(session as StorageArea).store[k] = items[k];
			} else if (k === "mimir_cache_metadata") {
				(session as StorageArea).store[k] = items[k];
			}
		});

		await Promise.all([
			setCachedContent(10, { text: "a", title: "A", url: "u" }),
			setCachedContent(20, { text: "b", title: "B", url: "u" }),
		]);

		const stats = await getCacheStats();
		expect(stats.entryCount).toBe(2);
		// totalSize should be sum of both small payloads, not doubled.
		expect(stats.totalSize).toBeLessThan(10_000);
	});

	it("skips writes that exceed the per-entry ceiling", async () => {
		const { setCachedContent, getCacheStats } = await loadModule();

		await setCachedContent(5, { text: "x".repeat(2_000_000), title: "T", url: "u" });
		const stats = await getCacheStats();
		expect(stats.entryCount).toBe(0);
	});
});
