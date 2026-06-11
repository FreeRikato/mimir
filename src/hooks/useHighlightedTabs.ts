import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChromeTab } from "../types";
import { createMountedRef } from "../utils/mountedRef";
import { getHighlightedTabs } from "../utils/tabHelpers";

/**
 * Tracks the currently Chrome-highlighted tabs.
 *
 * Bug RC-5: the prior version called `setHighlightedTabs` and
 * `setHighlightedCount` from async listeners without an `isMountedRef`
 * guard. On a quick panel re-mount the listener could resolve after
 * the component was already gone, producing the React 18 "Can't
 * perform a state update on an unmounted component" warning. The
 * sibling `useTabs` hook has the same pattern (inlined); this hook
 * now uses the shared `createMountedRef()` helper for consistency.
 */
export function useHighlightedTabs() {
	const [highlightedCount, setHighlightedCount] = useState(0);
	const [highlightedTabs, setHighlightedTabs] = useState<ChromeTab[]>([]);

	// One ref per component instance. Marked unmounted in the cleanup
	// of the mount effect; the async fetch guards on it before any
	// setState.
	const mountedRef = useMemo(() => createMountedRef(), []);

	useEffect(() => {
		mountedRef.markMounted();
		return () => {
			mountedRef.markUnmounted();
		};
	}, [mountedRef]);

	// Function to fetch and update highlighted tabs. Guarded by
	// `mountedRef` so a late-resolving fetch after unmount is a
	// safe no-op.
	const fetchHighlightedTabs = useCallback(async () => {
		const tabs = await getHighlightedTabs();
		if (!mountedRef.isMounted()) return;
		// COR-1: drop entries with a corrupt shape. The previous version
		// applied the chrome.tabs.query result as-is; a stub in tests or
		// a future Chrome change can leak entries without `id` or `url`,
		// which then crash downstream consumers (TabItem.tsx reads
		// `tab.id` unconditionally).
		const valid = tabs.filter(
			(t): t is ChromeTab =>
				t !== null && typeof t === "object" && typeof t.id === "number" && typeof t.url === "string",
		);
		setHighlightedTabs(valid);
		setHighlightedCount(valid.length);
	}, [mountedRef]);

	// Initial load
	useEffect(() => {
		fetchHighlightedTabs();
	}, [fetchHighlightedTabs]);

	// Listen for highlighted tab changes in Chrome
	useEffect(() => {
		const handleHighlightedChange = () => {
			fetchHighlightedTabs();
		};

		chrome.tabs.onHighlighted.addListener(handleHighlightedChange);

		return () => {
			chrome.tabs.onHighlighted.removeListener(handleHighlightedChange);
		};
	}, [fetchHighlightedTabs]);

	return {
		highlightedCount,
		highlightedTabs,
		updateHighlightedTabs: fetchHighlightedTabs,
	};
}
