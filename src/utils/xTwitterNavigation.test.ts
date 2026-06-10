/**
 * Tests for the SPA navigation wiring in the X/Twitter content script.
 *
 * Contract (MEM-2):
 *   - `popstate` clears the store.
 *   - `pushState` clears the store when navigating AWAY from a thread page.
 *   - `replaceState` clears the store on same-page thread re-renders.
 *   - The teardown function restores the original `pushState` /
 *     `replaceState` and removes the `popstate` listener.
 *   - `onClear` fires when the store is cleared by navigation.
 *
 * We avoid a DOM dependency by stubbing `window` and `history` with plain
 * objects. No jsdom required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createXDataStore, type XDataStore } from "./xDataStore";
import { installXNavigationListeners } from "./xTwitterNavigation";

interface FakeHistoryState {
	pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
	replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
}

interface FakeWindow {
	location: { pathname: string; href: string };
	history: FakeHistoryState;
	listeners: Map<string, Set<(ev: unknown) => void>>;
	addEventListener(type: string, fn: (ev: unknown) => void): void;
	removeEventListener(type: string, fn: (ev: unknown) => void): void;
	dispatch(type: string, payload?: unknown): void;
}

function makeFakeWindow(initialPath: string, history?: Partial<FakeHistoryState>): FakeWindow {
	const listeners = new Map<string, Set<(ev: unknown) => void>>();
	const win: FakeWindow = {
		location: { pathname: initialPath, href: `https://x.com${initialPath}` },
		listeners,
		addEventListener(type, fn) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(fn);
		},
		removeEventListener(type, fn) {
			listeners.get(type)?.delete(fn);
		},
		dispatch(type, payload) {
			for (const fn of listeners.get(type) ?? []) fn(payload);
		},
		history: {
			pushState: history?.pushState ?? (() => {}),
			replaceState: history?.replaceState ?? (() => {}),
		},
	};
	return win;
}

describe("installXNavigationListeners (MEM-2: SPA navigation clears the store)", () => {
	let store: XDataStore;
	let win: FakeWindow;
	let teardown: () => void;

	beforeEach(() => {
		store = createXDataStore();
		store.set("tweet-1", { id: "tweet-1" });
	});

	afterEach(() => {
		teardown?.();
		store.dispose();
	});

	it("clears the store on popstate (back / forward navigation)", () => {
		win = makeFakeWindow("/home");
		teardown = installXNavigationListeners({ store }, win as unknown as Window & typeof globalThis);

		expect(store.size()).toBe(1);
		win.dispatch("popstate", {});
		expect(store.size()).toBe(0);
	});

	it("clears the store on pushState when leaving a thread page", () => {
		win = makeFakeWindow("/username/status/1234");
		teardown = installXNavigationListeners({ store }, win as unknown as Window & typeof globalThis);

		expect(store.size()).toBe(1);
		// Navigate to a non-thread path.
		win.history.pushState({}, "", "/explore");
		win.location.pathname = "/explore";
		expect(store.size()).toBe(0);
	});

	it("does NOT clear the store on pushState to another thread (LRU handles it)", () => {
		win = makeFakeWindow("/username/status/1234");
		teardown = installXNavigationListeners({ store }, win as unknown as Window & typeof globalThis);

		expect(store.size()).toBe(1);
		// Same shape (still a thread) — cache should survive.
		win.history.pushState({}, "", "/username/status/9999");
		win.location.pathname = "/username/status/9999";
		expect(store.size()).toBe(1);
	});

	it("clears the store on replaceState of a thread URL (same-page re-render)", () => {
		win = makeFakeWindow("/username/status/1234");
		teardown = installXNavigationListeners({ store }, win as unknown as Window & typeof globalThis);

		expect(store.size()).toBe(1);
		win.history.replaceState({}, "", "/username/status/9999");
		win.location.pathname = "/username/status/9999";
		expect(store.size()).toBe(0);
	});

	it("teardown restores the original pushState / replaceState and removes the popstate listener", () => {
		// Use vi.fn() so we can assert call counts on the originals.
		const originalPush = vi.fn();
		const originalReplace = vi.fn();
		win = makeFakeWindow("/home", { pushState: originalPush, replaceState: originalReplace });
		// After install, the history methods are replaced with wrappers.
		teardown = installXNavigationListeners({ store }, win as unknown as Window & typeof globalThis);

		// The wrappers should call through to the originals, so we can detect
		// post-teardown restoration by side effect (original fn called) and by
		// reference (history.pushState === originalPush after teardown).

		teardown();

		// After teardown, history.pushState / replaceState reference the originals.
		expect(win.history.pushState).toBe(originalPush);
		expect(win.history.replaceState).toBe(originalReplace);

		// popstate listener is removed — store must survive a synthetic popstate.
		// (beforeEach set tweet-1, the test adds tweet-2, total = 2.)
		store.set("tweet-2", { id: "tweet-2" });
		win.dispatch("popstate", {});
		expect(store.size()).toBe(2);

		// Restored pushState / replaceState do NOT clear the store (wrappers
		// are gone) and ARE called (vi.fn() captured the call). Both push
		// targets are non-thread, current path is non-thread, so the wrapper
		// would not have cleared even if it were installed.
		win.history.pushState({}, "", "/explore");
		win.history.replaceState({}, "", "/explore");
		expect(store.size()).toBe(2);
		expect(originalPush).toHaveBeenCalledTimes(1);
		expect(originalReplace).toHaveBeenCalledTimes(1);
	});

	it("onClear hook fires when the store is cleared by navigation", () => {
		win = makeFakeWindow("/username/status/1234");
		const onClear = vi.fn();
		teardown = installXNavigationListeners({ store, onClear }, win as unknown as Window & typeof globalThis);

		win.dispatch("popstate", {});
		expect(onClear).toHaveBeenCalledTimes(1);
	});
});
