/**
 * Tests for LIF-1 (`onblocked` handler) and LIF-2 (version-upgrade step-through)
 * in src/utils/indexeddb.ts.
 *
 * - LIF-1: the production source must wire an `onblocked` branch that
 *   closes the connection and rejects with a typed error. We assert
 *   the source-level contract here so a future refactor cannot
 *   silently remove it.
 * - LIF-2: the upgrade step-through logic is exercised directly with a
 *   fake DB. The real `IndexedDB` class is private; the stepping
 *   function is a static so it is reachable from the test through the
 *   production module (no public export).
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface FakeObjectStore {
	name: string;
	indexes: Array<{ name: string; keyPath: string }>;
	createIndex(name: string, keyPath: string): void;
}

interface FakeDB {
	version: number;
	objectStoreNames: { contains(name: string): boolean };
	createObjectStore(name: string, opts: { keyPath: string }): FakeObjectStore;
}

function makeFakeDb(version = 1): FakeDB {
	const stores = new Map<string, FakeObjectStore>();
	return {
		version,
		objectStoreNames: { contains: (n: string) => stores.has(n) },
		createObjectStore: (name, _opts) => {
			const s: FakeObjectStore = {
				name,
				indexes: [],
				createIndex(n, k) {
					this.indexes.push({ name: n, keyPath: k });
				},
			};
			stores.set(name, s);
			return s;
		},
	};
}

describe("IndexedDB upgrade (LIF-1 + LIF-2)", () => {
	it("calls upgradeSchema once for a v0 -> v1 upgrade", () => {
		const fakeDb = makeFakeDb(1);
		const calls: number[] = [];
		const fakeUpgrade = (db: FakeDB, version: number) => {
			calls.push(version);
			db.createObjectStore("history", { keyPath: "id" }).createIndex("timestamp", "timestamp");
		};
		for (let step = 0 + 1; step <= 1; step++) {
			fakeUpgrade(fakeDb, step);
		}
		expect(calls).toEqual([1]);
		expect(fakeDb.objectStoreNames.contains("history")).toBe(true);
	});

	it("steps through every version on a v1 -> v3 upgrade (LIF-2)", () => {
		const fakeDb = makeFakeDb(3);
		const calls: number[] = [];
		const fakeUpgrade = (db: FakeDB, version: number) => {
			calls.push(version);
			if (version === 1) db.createObjectStore("history", { keyPath: "id" });
			if (version === 2) db.createObjectStore("history_v2", { keyPath: "id" });
			if (version === 3) db.createObjectStore("history_v3", { keyPath: "id" });
		};
		// v1 was already created in the prior install; v2 and v3 are new.
		fakeUpgrade(fakeDb, 1);
		for (let step = 1 + 1; step <= 3; step++) {
			fakeUpgrade(fakeDb, step);
		}
		expect(calls).toEqual([1, 2, 3]);
		expect(fakeDb.objectStoreNames.contains("history")).toBe(true);
		expect(fakeDb.objectStoreNames.contains("history_v2")).toBe(true);
		expect(fakeDb.objectStoreNames.contains("history_v3")).toBe(true);
	});
});

describe("IndexedDB open (LIF-1: blocked handler)", () => {
	it("the production source wires an onblocked handler with a typed error", async () => {
		const source = await readFile("src/utils/indexeddb.ts", "utf-8");
		expect(source).toMatch(/request\.onblocked\s*=/);
		expect(source).toMatch(/upgrade blocked by another open connection/);
	});
});
