/**
 * Single source of truth for the clipboard fallback channel used by
 * `SidePanelApp.tsx`. The previous implementation kept a module-level
 * `pendingClipboardData` and a separate React state `pendingClipboardContent`
 * that were set/cleared in different code paths, allowing them to desync.
 *
 * This module replaces both with one object that exposes:
 *   - `setPending(value)` / `clearPending()` for symmetric lifecycle
 *   - `peek()` / `hasPending()` for read-only checks
 *   - `tryRetry({ hasFocus, write })` for the focus-event-driven retry
 *
 * The retry logic now re-checks `document.hasFocus()` and distinguishes
 * between focus-related failures (preserve the pending copy) and other
 * write failures (clear the pending copy, since the data is unrecoverable).
 *
 * Bug: 1.7 in `bug-list.md`.
 */
export type ClipboardRetryOutcome = "copied" | "requires_manual_copy" | "failed";

export interface ClipboardFallback<T> {
	setPending(value: T): void;
	clearPending(): void;
	peek(): T | null;
	hasPending(): boolean;
	tryRetry(opts: { hasFocus: () => boolean; write: (value: T) => Promise<void> }): Promise<ClipboardRetryOutcome>;
}

export function createClipboardFallback<T>(): ClipboardFallback<T> {
	let pending: T | null = null;

	function isFocusError(err: unknown): boolean {
		if (!(err instanceof Error)) return false;
		if (err.name === "NotAllowedError") return true;
		const msg = err.message || "";
		return msg.includes("not focused") || msg.includes("not allowed");
	}

	return {
		setPending(value) {
			pending = value;
		},
		clearPending() {
			pending = null;
		},
		peek() {
			return pending;
		},
		hasPending() {
			return pending !== null;
		},
		async tryRetry({ hasFocus, write }) {
			if (pending === null) return "copied";
			// Re-check focus even when the focus event fired — child focus
			// events can bubble up while the document itself is not focused.
			if (!hasFocus()) {
				return "requires_manual_copy";
			}
			try {
				await write(pending);
				pending = null;
				return "copied";
			} catch (err) {
				if (isFocusError(err)) {
					// Focus-related failure: preserve the pending data so the
					// user can hit "Copy Now" once the panel regains focus.
					return "requires_manual_copy";
				}
				// Non-focus failure (e.g. permissions, backend gone): clear
				// the pending data. The previous implementation would swallow
				// this and leave stale state behind.
				console.error("Clipboard write failed:", err);
				pending = null;
				return "failed";
			}
		},
	};
}
