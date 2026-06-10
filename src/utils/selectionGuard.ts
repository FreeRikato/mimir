/**
 * Selection-clearing guard for the three extraction handlers in
 * `SidePanelApp`.
 *
 * Bug: `handleExtractToRight` and `handleExtractHighlighted` call
 * `clearSelection()` in the SW success branch. The user's footer
 * selection is unrelated to the inputs of those two handlers (which
 * read `getTabsToRight()` and `chrome.tabs.query({highlighted:true})`
 * respectively), so calling `clearSelection()` is wrong AND racy:
 * a user who selects tabs while extraction is in flight loses the
 * newer selection when the older extraction finishes.
 *
 * Fix: capture the footer-selection snapshot at the moment the user
 * initiates the extraction. On success, only clear when the snapshot
 * is still authoritative (no user mutation has occurred since) AND
 * the actually-closed tabs overlap the snapshot.
 *
 *   const guard = createSelectionGuard();
 *   const snap = captureSnapshot();
 *   // ... extraction runs ...
 *   if (guard.shouldClear(snap, closedIds, currentSelection)) {
 *     clearSelection();
 *   }
 *
 * The wiring in SidePanelApp captures the snapshot *before* the SW
 * call. `shouldClear` returns true exactly when the user's footer
 * selection still matches the snapshot they made when they hit
 * "Extract", and the SW actually closed at least one of those tabs.
 */
export interface SelectionSnapshot {
	/**
	 * A monotonically incrementing seq captured by the guard. The
	 * caller stores it alongside its selection Set. Bumping happens
	 * on `markMutated()` and on every `captureSnapshot()` call.
	 */
	readonly seq: number;
	/**
	 * The selection Set the caller captured. Stored by reference so
	 * we can later compare against the caller's "current" selection.
	 */
	readonly ids: ReadonlySet<number>;
}

export interface SelectionGuard {
	/**
	 * Capture the current selection. The returned snapshot holds a
	 * monotonically incrementing seq that the caller pairs with its
	 * current selection ids.
	 */
	captureSnapshot(currentSelection: ReadonlySet<number>): SelectionSnapshot;
	/**
	 * Mark the user's selection as mutated (e.g. a tab toggle, a
	 * domain toggle, a refresh). Any in-flight snapshot is now
	 * considered stale; subsequent `shouldClear` calls return false.
	 */
	markMutated(): void;
	/**
	 * Decide whether to call `clearSelection()`. Returns true when
	 * the snapshot is still authoritative AND the SW actually closed
	 * at least one tab that was in the user's selection at the
	 * moment of capture.
	 */
	shouldClear(
		snapshot: SelectionSnapshot,
		closedTabIds: ReadonlyArray<number>,
		currentSelection: ReadonlySet<number>,
	): boolean;
	/**
	 * The current generation seq. Tests + advanced callers.
	 */
	currentSeq(): number;
}

export function createSelectionGuard(): SelectionGuard {
	let seq = 0;
	return {
		captureSnapshot: (currentSelection: ReadonlySet<number>) => {
			seq += 1;
			return { seq, ids: currentSelection };
		},
		markMutated: () => {
			seq += 1;
		},
		shouldClear: (snapshot, closedTabIds, currentSelection) => {
			// The snapshot is stale if the guard's current seq is
			// higher than the snapshot's seq, OR if the user's
			// current selection has diverged from the captured
			// selection (the user toggled a tab in the meantime).
			if (snapshot.seq !== seq) return false;
			if (snapshot.ids !== currentSelection) return false;
			// At least one closed tab must have been in the user's
			// captured selection; otherwise there's nothing to clear
			// that the user actually selected.
			for (const id of closedTabIds) {
				if (snapshot.ids.has(id)) return true;
			}
			return false;
		},
		currentSeq: () => seq,
	};
}
