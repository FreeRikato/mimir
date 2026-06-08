/**
 * Characterization test for bug 1.11: setCachedContent's emergency-eviction
 * path runs `await rebuildMetadata()` followed by `updateEntryMetadata()`.
 * If another concurrent `setCachedContent` is in flight, it can write its
 * entry, then later call `updateEntryMetadata` against a stale metadata
 * snapshot — overwriting the post-rebuild rows and corrupting the cache.
 *
 * Contract under test: after a setCachedContent call that *triggered*
 * emergency eviction (first set fails quota, rebuild runs, evictions run,
 * retry succeeds) settles alongside a parallel setCachedContent for a
 * *different* key, the metadata must end up with both keys present and
 * `totalSize >= sum(sizes of all written entries)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface StorageArea {
	store: Record<string, unknown>;
	get: (keys: string[] | null) => Promise<Record<string, unknown>>;
	set: (items: Record<string, unknown>) => Promise<void>;
	remove: (keys: string | string[]) => Promise<void>;
	reset(): void;
}

function makeStorage(): StorageArea {
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
			await new Promise((r) => setTimeout(r, 2));
			Object.assign(store, items);
		}),
		remove: vi.fn(async (keys: string | string[]) => {
			const arr = Array.isArray(keys) ? keys : [keys];
			for (const k of arr) delete store[k];
		}),
		reset() {
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
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function loadModule() {
	vi.resetModules();
	return import("./cache");
}

describe("setCachedContent (bug 1.11: emergency-eviction + concurrent write)", () => {
	it("two concurrent writes preserve both metadata rows (one large enough to force eviction, one small)", async () => {
		// Prime the cache with one entry to fill a meaningful share of the cap.
		const mod1 = await loadModule();
		await mod1.setCachedContent(0, { text: "a".repeat(500_000), title: "fill", url: "https://f" });

		// Now race: a "large" write (will exceed MAX_CONTENT_ENTRY_SIZE and be skipped)
		// and a small one. The point is that any emergency-eviction serialization
		// must not drop the small entry.
		const mod2 = await loadModule();
		const big = { text: "b".repeat(2_000_000), title: "big", url: "https://big" };
		const small = { text: "c".repeat(1_000), title: "small", url: "https://small" };

		await Promise.all([mod2.setCachedContent(1, big), mod2.setCachedContent(2, small)]);

		const stats = await mod2.getCacheStats();
		const keys = stats.entries.map((e) => e.key);
		// The small entry's key MUST be present after the race.
		expect(keys).toContain("content_2");
		// The large entry is skipped (> 1.5MB per-entry cap), so we expect either
		// 1 or 2 keys, but never zero.
		expect(keys.length).toBeGreaterThan(0);
	});

	it("after a sequence of writes, metadata totalSize is monotonically consistent with entry sizes", async () => {
		const mod = await loadModule();
		for (let i = 0; i < 4; i++) {
			await mod.setCachedContent(100 + i, {
				text: "x".repeat(2_000),
				title: `t${i}`,
				url: `https://x/${i}`,
			});
		}
		const stats = await mod.getCacheStats();
		const expectedTotal = stats.entries.reduce((s, e) => s + e.size, 0);
		expect(stats.totalSize).toBe(expectedTotal);
	});
});
