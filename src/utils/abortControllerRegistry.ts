/**
 * Single in-flight AbortController for the three extraction handlers
 * in `SidePanelApp`.
 *
 * Bug: each handler held its own AbortController in React state
 * (`abortController`, `toRightAbortController`, `highlightedAbortController`).
 * Cancellation only worked for the controller matching the *latest*
 * of its kind. A user who started `handleExtractToRight`, hit cancel,
 * then started `handleExtractHighlighted` had BOTH controllers in
 * state; cancel of the second only killed the second.
 *
 * Fix: one slot. Each handler replaces the current controller and
 * aborts the previous one in the same tick. State can still mirror
 * the current controller for the cancel button to read.
 */
export interface AbortControllerRegistry {
	/**
	 * Begin a new run. Aborts the previous controller (if any) and
	 * installs the new one. Returns the new controller.
	 */
	begin(): AbortController;
	/**
	 * Abort the current controller (no-op if none). Used by the
	 * cancel button.
	 */
	abort(): void;
	/**
	 * Clear the current slot. Call after a run settles (success,
	 * error, cancel) so the next `begin()` is a clean transition.
	 */
	clear(): void;
	/**
	 * Read the current controller (for the cancel button binding).
	 */
	current(): AbortController | null;
}

export function createAbortControllerRegistry(): AbortControllerRegistry {
	let current: AbortController | null = null;
	return {
		begin: () => {
			// Aborting the previous one ensures a stale run that
			// missed its own cancel button can no longer drive
			// state updates.
			if (current) {
				try {
					current.abort();
				} catch {
					// Some hosts throw if already aborted; ignore.
				}
			}
			current = new AbortController();
			return current;
		},
		abort: () => {
			if (!current) return;
			try {
				current.abort();
			} catch {
				// ignore
			}
		},
		clear: () => {
			current = null;
		},
		current: () => current,
	};
}
