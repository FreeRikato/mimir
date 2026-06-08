/**
 * Pure state machine for the `useHistory` hook's pagination + search state.
 *
 * Bug 1.4 (useHistory addEntry checks isSearchActive but search() doesn't
 * reset currentLimit): when search is invoked, `currentLimit` retained its
 * prior value, so a subsequent `clearSearch → refresh` would still load
 * more than `PAGE_SIZE` items. The new `transitionToSearch` resets the
 * limit to the page size before storing the search results.
 *
 * Bug 1.18 (useHistory search() returns no count): the count surfaced in
 * the HistoryPanel header remained the *total* count, not the search-hit
 * count. The new `transitionToSearch` captures the result count so the
 * UI can show "12 of 47" instead of just "47".
 */

export const HISTORY_PAGE_SIZE = 20;

export interface HistoryPaginationState {
	currentLimit: number;
	isSearchActive: boolean;
}

export const initialHistoryPagination: HistoryPaginationState = {
	currentLimit: HISTORY_PAGE_SIZE,
	isSearchActive: false,
};

/** Called when the user types a search query. Resets the limit and
 *  records the search-hit count for the HistoryPanel header (bug 1.18). */
export function transitionToSearch(
	state: HistoryPaginationState,
	resultCount: number,
): HistoryPaginationState & { count: number } {
	void state;
	return {
		currentLimit: HISTORY_PAGE_SIZE,
		isSearchActive: true,
		count: resultCount,
	};
}

/** Called when the user clears the search. Resets the limit + leaves search. */
export function transitionClearSearch(): HistoryPaginationState {
	return {
		currentLimit: HISTORY_PAGE_SIZE,
		isSearchActive: false,
	};
}

/** Called when the user loads more entries (only valid outside search). */
export function transitionLoadMore(state: HistoryPaginationState): HistoryPaginationState {
	return {
		...state,
		currentLimit: state.currentLimit + HISTORY_PAGE_SIZE,
	};
}

/** The search results' count is derived from the storage layer; the hook
 *  assigns it to React state. The helper here exists to make the search-
 *  hit count *tracked* alongside the state. */
export function deriveSearchCount(resultCount: number, _state: HistoryPaginationState): number {
	void _state;
	return resultCount;
}
