import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionStore: Record<string, unknown> = {};
const session = {
	get: vi.fn(async (keys: string[]) => {
		const out: Record<string, unknown> = {};
		for (const k of keys) if (k in sessionStore) out[k] = sessionStore[k];
		return out;
	}),
	set: vi.fn(async (items: Record<string, unknown>) => {
		Object.assign(sessionStore, items);
	}),
};

beforeEach(() => {
	for (const k of Object.keys(sessionStore)) delete sessionStore[k];
	(globalThis as unknown as { chrome: { storage: { session: typeof session } } }).chrome = { storage: { session } };
});

afterEach(() => {
	vi.resetModules();
	(globalThis as unknown as { chrome?: unknown }).chrome = undefined;
});

describe("persistedScroll (COR-10: scroll position persistence)", () => {
	it("round-trips a value through save/load", async () => {
		vi.resetModules();
		const { saveScrollSnapshot, loadScrollSnapshot } = await import("./persistedScroll");
		await saveScrollSnapshot("home", 123);
		expect(await loadScrollSnapshot("home")).toBe(123);
	});

	it("returns 0 for an unknown route", async () => {
		vi.resetModules();
		const { loadScrollSnapshot } = await import("./persistedScroll");
		expect(await loadScrollSnapshot("unknown")).toBe(0);
	});

	it("uses the latest saved route when the key is reused", async () => {
		vi.resetModules();
		const { saveScrollSnapshot, loadScrollSnapshot } = await import("./persistedScroll");
		// A single key can only hold one snapshot at a time. The contract
		// is that the most recent save wins; a different route returns 0.
		await saveScrollSnapshot("home", 100);
		expect(await loadScrollSnapshot("home")).toBe(100);
		await saveScrollSnapshot("history", 200);
		expect(await loadScrollSnapshot("history")).toBe(200);
		expect(await loadScrollSnapshot("home")).toBe(0);
	});
});
