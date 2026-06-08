import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportFormat, ExtractedData, HistoryEntry, SearchQuery } from "../types";
import {
	createHistoryEntry,
	deleteAllHistory,
	deleteHistoryEntry,
	getHistoryCount,
	getHistoryEntries,
	saveHistoryEntry,
	searchHistory as searchHistoryStorage,
} from "../utils/historyStorage";

const PAGE_SIZE = 20;

interface UseHistoryReturn {
	entries: HistoryEntry[];
	count: number;
	isLoading: boolean;
	error: string | null;
	hasMore: boolean;
	refresh: () => Promise<void>;
	loadMore: () => Promise<void>;
	addEntry: (
		data: ExtractedData[],
		format: ExportFormat,
		exportType: "clipboard" | "file",
		filename?: string,
	) => Promise<HistoryEntry | null>;
	deleteEntry: (id: string) => Promise<boolean>;
	clearAll: () => Promise<boolean>;
	search: (query: SearchQuery) => Promise<void>;
	clearSearch: () => Promise<void>;
	// Bug 1.18: the search-hit count, surfaced to HistoryPanel so the header
	// shows "N of M" instead of just "M" when the user is searching.
	searchResultCount: number | null;
}

export function useHistory(): UseHistoryReturn {
	const [entries, setEntries] = useState<HistoryEntry[]>([]);
	const [count, setCount] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [currentLimit, setCurrentLimit] = useState(PAGE_SIZE);
	const [isSearchActive, setIsSearchActive] = useState(false);
	// Bug 1.18: the search-hit count, surfaced to HistoryPanel so the header
	// shows "N of M" instead of just "M" when the user is searching.
	const [searchResultCount, setSearchResultCount] = useState<number | null>(null);

	// Use refs to avoid dependency issues
	const isLoadingRef = useRef(isLoading);
	const hasMoreRef = useRef(hasMore);

	// Keep refs in sync with state
	useEffect(() => {
		isLoadingRef.current = isLoading;
		hasMoreRef.current = hasMore;
	}, [isLoading, hasMore]);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		setIsSearchActive(false);
		setCurrentLimit(PAGE_SIZE);
		setSearchResultCount(null);

		try {
			const [fetchedEntries, fetchedCount] = await Promise.all([getHistoryEntries(PAGE_SIZE), getHistoryCount()]);

			setEntries(fetchedEntries);
			setCount(fetchedCount);
			setHasMore(fetchedCount > PAGE_SIZE);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load history");
			console.error("Failed to refresh history:", err);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const loadMore = useCallback(async () => {
		// Use refs to check current state values
		if (isLoadingRef.current || !hasMoreRef.current) return;

		setIsLoading(true);

		try {
			const newLimit = currentLimit + PAGE_SIZE;
			const fetchedEntries = await getHistoryEntries(newLimit);

			setEntries(fetchedEntries);
			setCurrentLimit(newLimit);
			setHasMore(fetchedEntries.length === newLimit);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load more history");
			console.error("Failed to load more history:", err);
		} finally {
			setIsLoading(false);
		}
	}, [currentLimit]);

	const addEntry = useCallback(
		async (
			data: ExtractedData[],
			format: ExportFormat,
			exportType: "clipboard" | "file",
			filename?: string,
		): Promise<HistoryEntry | null> => {
			if (data.length === 0) return null;

			try {
				const entryData = createHistoryEntry(data, format, exportType, filename);
				const newEntry = await saveHistoryEntry(entryData);

				if (newEntry && !isSearchActive) {
					// Prepend to current entries
					setEntries((prev) => [newEntry, ...prev]);
					setCount((prev) => prev + 1);
				}

				return newEntry;
			} catch (err) {
				console.error("Failed to add history entry:", err);
				return null;
			}
		},
		[isSearchActive],
	);

	const deleteEntry = useCallback(async (id: string): Promise<boolean> => {
		try {
			const success = await deleteHistoryEntry(id);

			if (success) {
				setEntries((prev) => prev.filter((entry) => entry.id !== id));
				setCount((prev) => Math.max(0, prev - 1));
			}

			return success;
		} catch (err) {
			console.error("Failed to delete history entry:", err);
			return false;
		}
	}, []);

	const clearAll = useCallback(async (): Promise<boolean> => {
		try {
			const success = await deleteAllHistory();

			if (success) {
				setEntries([]);
				setCount(0);
				setHasMore(false);
				setCurrentLimit(PAGE_SIZE);
			}

			return success;
		} catch (err) {
			console.error("Failed to clear history:", err);
			return false;
		}
	}, []);

	const search = useCallback(async (query: SearchQuery) => {
		setIsLoading(true);
		setError(null);
		setIsSearchActive(true);
		// Bug 1.4: reset currentLimit to PAGE_SIZE on every new search so a
		// later clearSearch → refresh does not load more than PAGE_SIZE entries.
		setCurrentLimit(PAGE_SIZE);

		try {
			const results = await searchHistoryStorage(query);
			setEntries(results);
			setHasMore(false); // Search results are not paginated
			// Bug 1.18: capture the hit count so the UI can show "N of M".
			setSearchResultCount(results.length);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Search failed");
			console.error("Failed to search history:", err);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const clearSearch = useCallback(async () => {
		setIsSearchActive(false);
		setSearchResultCount(null);
		await refresh();
	}, [refresh]);

	// Listen for window visibility changes to refresh when user returns to the tab
	// This ensures data stays fresh if changes were made elsewhere
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (!document.hidden && !isSearchActive) {
				refresh();
			}
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [refresh, isSearchActive]);

	// Initial load - only run once on mount
	useEffect(() => {
		let isMounted = true;

		const initialLoad = async () => {
			setIsLoading(true);
			setError(null);
			setIsSearchActive(false);
			setCurrentLimit(PAGE_SIZE);
			setSearchResultCount(null);

			try {
				const [fetchedEntries, fetchedCount] = await Promise.all([getHistoryEntries(PAGE_SIZE), getHistoryCount()]);

				if (isMounted) {
					setEntries(fetchedEntries);
					setCount(fetchedCount);
					setHasMore(fetchedCount > PAGE_SIZE);
				}
			} catch (err) {
				if (isMounted) {
					setError(err instanceof Error ? err.message : "Failed to load history");
					console.error("Failed to load history:", err);
				}
			} finally {
				if (isMounted) {
					setIsLoading(false);
				}
			}
		};

		initialLoad();

		return () => {
			isMounted = false;
		};
	}, []); // Empty deps - only run on mount

	return {
		entries,
		count,
		isLoading,
		error,
		hasMore,
		refresh,
		loadMore,
		addEntry,
		deleteEntry,
		clearAll,
		search,
		clearSearch,
		searchResultCount,
	};
}
