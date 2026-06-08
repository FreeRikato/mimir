/**
 * Tiny `setTimeout`-based debouncer for the four chrome.tabs.* listeners in
 * SidePanelApp's `useEffect` (bug 1.9: opening 20 tabs in a second = 20
 * queries; debounce to a single chrome.tabs.query after DEBOUNCE_DELAY ms).
 *
 * The helper is intentionally framework-agnostic so it can be reused in
 * any React effect (or outside React). The hook composes a debounced
 * callback that can be cancelled and refreshed.
 */
export interface Debouncer {
	schedule(fn: () => void): void;
	cancel(): void;
	flush(): void;
}

export function createDebouncer(delayMs: number): Debouncer {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: (() => void) | null = null;

	return {
		schedule(fn: () => void) {
			pending = fn;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				const toRun = pending;
				pending = null;
				timer = null;
				if (toRun) toRun();
			}, delayMs);
		},
		cancel() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			pending = null;
		},
		flush() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			const toRun = pending;
			pending = null;
			if (toRun) toRun();
		},
	};
}
