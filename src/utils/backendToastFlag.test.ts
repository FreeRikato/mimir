/**
 * Characterization test for bug 1.8: hasShownBackendUnavailableToast was a
 * module-level `let` in `subtitles.ts`. When the side panel closes and
 * reopens, the module reloads and the flag resets, causing the toast to
 * re-fire even after dismissal.
 *
 * The fix persists the flag in `chrome.storage.session` (key:
 * `mimir_backend_unavailable_toast_shown`) so the dismissal survives the
 * module reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBackendUnavailableToastFlag, setBackendUnavailableToastFlag } from "./backendToastFlag";

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

describe("backendToastFlag (bug 1.8: persistence across module reloads)", () => {
	it("loads false when nothing is stored", async () => {
		expect(await loadBackendUnavailableToastFlag()).toBe(false);
	});

	it("set(true) then load() returns true", async () => {
		await setBackendUnavailableToastFlag(true);
		expect(await loadBackendUnavailableToastFlag()).toBe(true);
	});

	it("set(false) after set(true) clears the flag", async () => {
		await setBackendUnavailableToastFlag(true);
		await setBackendUnavailableToastFlag(false);
		expect(await loadBackendUnavailableToastFlag()).toBe(false);
	});

	it("survives a simulated module reload (storage is module-scoped; the flag is not)", async () => {
		// First "module init": user dismisses the toast.
		await setBackendUnavailableToastFlag(true);
		// Second "module init" (the old bug): the storage entry still exists.
		// The pure helper reads from chrome.storage.session and reports true.
		// (This is what the new code does; the old code re-initialised the
		// module-level let to false and re-fired the toast.)
		const reloaded = await loadBackendUnavailableToastFlag();
		expect(reloaded).toBe(true);
	});
});
