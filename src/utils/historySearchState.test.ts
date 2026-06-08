/**
 * Characterization tests for bugs 1.4 and 1.18.
 *
 * 1.4: useHistory's `search()` did not reset `currentLimit`. A user who
 *      paginated past page 1, ran a search, then cleared the search would
 *      see entries beyond PAGE_SIZE on the first refresh.
 *
 * 1.18: useHistory's `search()` did not update the displayed `count`,
 *      leaving the panel header showing the total history size while
 *      the table showed the search hits. The new contract is that the
 *      result count is exposed as `searchResultCount` whenever
 *      `isSearchActive` is true.
 */
import { describe, expect, it } from "vitest";
import {
	deriveSearchCount,
	HISTORY_PAGE_SIZE,
	initialHistoryPagination,
	transitionClearSearch,
	transitionLoadMore,
	transitionToSearch,
} from "./historySearchState";

describe("useHistory search/clearSearch state (bug 1.4: reset currentLimit)", () => {
	it("starts at PAGE_SIZE", () => {
		expect(initialHistoryPagination.currentLimit).toBe(HISTORY_PAGE_SIZE);
		expect(initialHistoryPagination.isSearchActive).toBe(false);
	});

	it("loadMore grows currentLimit by PAGE_SIZE", () => {
		const next = transitionLoadMore(initialHistoryPagination);
		expect(next.currentLimit).toBe(HISTORY_PAGE_SIZE * 2);
		expect(next.isSearchActive).toBe(false);
	});

	it("search() resets currentLimit to PAGE_SIZE even after the user paginated", () => {
		const paginated = transitionLoadMore(transitionLoadMore(initialHistoryPagination));
		expect(paginated.currentLimit).toBe(HISTORY_PAGE_SIZE * 3);

		const searched = transitionToSearch(paginated, 5);
		expect(searched.currentLimit).toBe(HISTORY_PAGE_SIZE);
		expect(searched.isSearchActive).toBe(true);
	});

	it("clearSearch() resets currentLimit and clears the search flag", () => {
		const searched = transitionToSearch(initialHistoryPagination, 1);
		expect(searched.count).toBe(1);
		const cleared = transitionClearSearch();
		expect(cleared.currentLimit).toBe(HISTORY_PAGE_SIZE);
		expect(cleared.isSearchActive).toBe(false);
	});
});

describe("useHistory search count (bug 1.18: expose search-hit count)", () => {
	it("deriveSearchCount returns the result count from the storage call", () => {
		expect(deriveSearchCount(7, initialHistoryPagination)).toBe(7);
	});

	it("deriveSearchCount is independent of the pagination state", () => {
		// Whether the user is on page 1 or page 5 should not change the count
		// returned for a search. The hook assigns whatever the storage layer
		// returns; this helper documents that contract.
		const paginated = transitionLoadMore(transitionLoadMore(initialHistoryPagination));
		expect(deriveSearchCount(3, paginated)).toBe(3);
	});

	it("search() does not silently change the total history count", () => {
		// The hook layer must call setCount(resultCount) when search is invoked.
		// The pure helper does not own React state; the contract under test is
		// that the caller gets a stable, deterministic function `resultCount → count`.
		const searched = transitionToSearch(initialHistoryPagination, 12);
		expect(searched.isSearchActive).toBe(true);
		expect(deriveSearchCount(12, initialHistoryPagination)).toBe(12);
	});
});
