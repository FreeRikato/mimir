/**
 * Small helper that gates a "save" effect on a "load" effect having
 * completed. Used by `SidePanelApp.tsx` for the subtitle format and
 * subtitle language settings: the default state used on first render
 * must not be written to storage before the stored value is read, or
 * the load effect will see its own write and the stored value will be
 * clobbered.
 *
 * Bug: 1.6 in `bug-list.md`.
 */
export interface LoadedGuard {
	/** Mark the underlying setting as loaded. Future `save()` calls proceed. */
	markLoaded(): void;
	/**
	 * Save the value. No-op (no writer call) until `markLoaded()` has run.
	 * The returned promise resolves only after the writer (if invoked) settles.
	 */
	save<T>(value: T, writer: (value: T) => Promise<void>): Promise<void>;
}

export function createLoadedGuard(): LoadedGuard {
	let loaded = false;
	return {
		markLoaded() {
			loaded = true;
		},
		async save<T>(value: T, writer: (value: T) => Promise<void>): Promise<void> {
			if (!loaded) return;
			await writer(value);
		},
	};
}
