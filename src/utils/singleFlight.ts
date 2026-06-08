/**
 * A single-flight guard for the KEYBOARD_COMMAND listener (bug 1.23).
 *
 * If the user double-taps the keyboard shortcut, two extractions start in
 * parallel. The first to set the AbortController wins, the second's
 * controller is silently overwritten — the first extraction can no longer
 * be cancelled. This helper ensures only one extraction is in flight at a
 * time, and concurrent triggers during an in-flight run are dropped (or
 * queued, depending on the consumer).
 */
export interface SingleFlight {
	isBusy(): boolean;
	tryStart(): boolean;
	finish(): void;
}

export function createSingleFlight(): SingleFlight {
	let busy = false;
	return {
		isBusy: () => busy,
		tryStart: () => {
			if (busy) return false;
			busy = true;
			return true;
		},
		finish: () => {
			busy = false;
		},
	};
}
