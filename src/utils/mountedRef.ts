/**
 * Module-level + per-handler `isMountedRef` pattern.
 *
 * Bug RC-5: the prior `useHighlightedTabs` had no `isMountedRef` guard
 * on its async listener. A late-resolving `chrome.tabs.query` would
 * call setState on an unmounted component. The sibling `useTabs` hook
 * already has the pattern; this helper is the extracted contract so
 * both hooks (and any future ones) can share it.
 *
 * Usage in a hook:
 *   const mounted = useMemo(() => createMountedRef(), []);
 *   useEffect(() => () => mounted.markUnmounted(), [mounted]);
 *   const fetch = async () => {
 *     const data = await something();
 *     if (!mounted.isMounted()) return;
 *     setState(data);
 *   };
 */
export interface MountedRef {
	/** True until `markUnmounted()` is called. */
	isMounted(): boolean;
	/** Flip the ref to unmounted. Idempotent. */
	markUnmounted(): void;
	/** Mark the ref as mounted. Idempotent. Used by effects on mount. */
	markMounted(): void;
}

export function createMountedRef(): MountedRef {
	let mounted = true;
	return {
		isMounted: () => mounted,
		markUnmounted: () => {
			mounted = false;
		},
		markMounted: () => {
			mounted = true;
		},
	};
}
