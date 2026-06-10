/**
 * SPA navigation wiring for the X/Twitter content script.
 *
 * The content script runs in the MAIN world on x.com / twitter.com. It needs
 * to clear its in-page cache whenever the SPA navigates away from the current
 * thread, so the next extraction pulls fresh data.
 *
 * Browser facts that drive the design:
 *   - `popstate` fires on back/forward navigation, and on any history mutation
 *     made with `pushState` / `replaceState` (which DO NOT fire `popstate` on
 *     their own — that's the gotcha).
 *   - X's client-side router is custom and not exposed; we have no global
 *     "route changed" event. The most reliable hook is to monkey-patch
 *     `history.pushState` and `history.replaceState` and call our listener
 *     synchronously after the underlying call returns.
 *
 * Testability:
 *   - The wiring is split out of the content script so it can be exercised
 *     with a fake `window` and `history`. The content script delegates here.
 */

import type { XDataStore } from "./xDataStore";

export interface NavigationHooks {
	store: XDataStore;
	/** Optional callback fired whenever the store is cleared by navigation. */
	onClear?: () => void;
	/** Read the current pathname (defaults to `location.pathname`). */
	getPathname?: () => string;
	/** Whether the supplied path looks like a thread page. */
	isThreadPath?: (pathname: string) => boolean;
}

/**
 * Wires `popstate`, `pushState`, and `replaceState` to clear the store on
 * navigations that leave the current thread.
 *
 * Returns a teardown function that removes the `popstate` listener and
 * restores the original `pushState` / `replaceState`.
 */
export function installXNavigationListeners(hooks: NavigationHooks, win: Window & typeof globalThis): () => void {
	const isThreadPath = hooks.isThreadPath ?? ((p: string) => /\/status\/\d+/.test(p));
	const getPathname = hooks.getPathname ?? (() => win.location.pathname);

	const clear = (): void => {
		hooks.store.clear();
		hooks.onClear?.();
	};

	const onPopState = (): void => {
		clear();
	};

	win.addEventListener("popstate", onPopState);

	// Save the raw function references; the wrappers below rebind at call time.
	// (bind() returns a fresh function each call, so we cannot compare by
	// reference across teardown.)
	const originalPushState = win.history.pushState;
	const originalReplaceState = win.history.replaceState;

	const pushStatePatched: typeof win.history.pushState = ((data, unused, url) => {
		const result = originalPushState(data, unused, url);
		// Forward navigation: clear when the URL no longer points at a thread
		// (we are leaving the thread page entirely). Same-thread navigations
		// fall to the LRU.
		if (typeof url === "string" || url instanceof URL) {
			const nextPath = url instanceof URL ? url.pathname : new URL(url, win.location.href).pathname;
			if (!isThreadPath(nextPath) && isThreadPath(getPathname())) clear();
		} else {
			// URL omitted — X's router still considers it a same-page push.
			// If the supplied state carries a route, treat that as the truth.
			const route = readRouteFromState(data);
			if (route !== null && !isThreadPath(route) && isThreadPath(getPathname())) clear();
		}
		return result;
	}) as typeof win.history.pushState;

	const replaceStatePatched: typeof win.history.replaceState = ((data, unused, url) => {
		const result = originalReplaceState(data, unused, url);
		// replaceState on X is typically a same-page re-render with a new
		// tweet id — clear so the next GraphQL response refills the store.
		if (typeof url === "string" || url instanceof URL) {
			const nextPath = url instanceof URL ? url.pathname : new URL(url, win.location.href).pathname;
			if (isThreadPath(nextPath)) clear();
		} else {
			const route = readRouteFromState(data);
			if (route !== null && isThreadPath(route)) clear();
		}
		return result;
	}) as typeof win.history.replaceState;

	win.history.pushState = pushStatePatched;
	win.history.replaceState = replaceStatePatched;

	return () => {
		win.removeEventListener("popstate", onPopState);
		win.history.pushState = originalPushState;
		win.history.replaceState = originalReplaceState;
	};
}

function readRouteFromState(state: unknown): string | null {
	if (!state || typeof state !== "object") return null;
	const route = (state as { route?: unknown }).route;
	return typeof route === "string" ? route : null;
}
