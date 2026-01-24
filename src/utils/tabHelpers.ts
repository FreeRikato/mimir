import type { ChromeTab } from "../types";

/**
 * Gets all tabs positioned to the right of the currently active tab
 * in the same window. Filters out internal Chrome pages.
 */
export async function getTabsToRight(): Promise<ChromeTab[]> {
	try {
		// Get the active tab in the current window
		const [activeTab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		if (!activeTab?.id || activeTab.index === undefined) {
			return [];
		}

		// Get all tabs in the current window
		const allTabs = await chrome.tabs.query({ windowId: activeTab.windowId });

		// Filter and map tabs to the right of active tab
		const tabsToRight = allTabs.filter(
			(tab): tab is chrome.tabs.Tab & { id: number; url: string } =>
				tab.index > activeTab.index &&
				tab.id !== undefined &&
				tab.url !== undefined &&
				!tab.url.startsWith("chrome://") &&
				!tab.url.startsWith("chrome-extension://") &&
				!tab.url.startsWith("edge://") &&
				!tab.url.startsWith("about:"),
		);

		return tabsToRight.map((tab) => ({
			id: tab.id,
			windowId: tab.windowId,
			index: tab.index,
			title: tab.title || "Untitled",
			url: tab.url,
			favIconUrl: tab.favIconUrl,
		}));
	} catch (error) {
		console.error("Failed to get tabs to right:", error);
		return [];
	}
}

/**
 * Counts the number of tabs to the right of the currently active tab
 * in the same window. Returns 0 if unable to determine.
 */
export async function getTabsToRightCount(): Promise<number> {
	const tabs = await getTabsToRight();
	return tabs.length;
}

/**
 * Gets all tabs that are highlighted (selected via Cmd+click / Shift+click)
 * in Chrome's native tab bar. Filters out internal Chrome pages.
 */
export async function getHighlightedTabs(): Promise<ChromeTab[]> {
	try {
		const highlightedTabs = await chrome.tabs.query({
			highlighted: true,
		});

		return highlightedTabs
			.filter(
				(tab): tab is chrome.tabs.Tab & { id: number; url: string } =>
					tab.id !== undefined &&
					tab.url !== undefined &&
					!tab.url.startsWith("chrome://") &&
					!tab.url.startsWith("chrome-extension://") &&
					!tab.url.startsWith("edge://") &&
					!tab.url.startsWith("about:"),
			)
			.map((tab) => ({
				id: tab.id,
				windowId: tab.windowId,
				index: tab.index,
				title: tab.title || "Untitled",
				url: tab.url,
				favIconUrl: tab.favIconUrl,
				highlighted: tab.highlighted,
				active: tab.active,
			}));
	} catch (error) {
		console.error("Failed to get highlighted tabs:", error);
		return [];
	}
}

/**
 * Counts the number of highlighted tabs. Returns 0 if unable to determine.
 */
export async function getHighlightedTabsCount(): Promise<number> {
	const tabs = await getHighlightedTabs();
	return tabs.length;
}

/**
 * Result of closing tabs operation
 */
export interface CloseTabsResult {
	closed: number;
	failed: number;
	activeProtected: boolean;
}

/**
 * Closes tabs safely while protecting the active tab.
 * Filters out the active tab from the list before closing.
 * Re-queries the active tab immediately before closing to minimize race conditions.
 * Returns statistics about the operation.
 */
export async function closeTabsSafely(tabIds: number[]): Promise<CloseTabsResult> {
	if (tabIds.length === 0) {
		return { closed: 0, failed: 0, activeProtected: false };
	}

	try {
		// Re-query active tab immediately before closing to minimize race condition
		// (user could switch tabs between the call to this function and the close operation)
		const [activeTab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		const activeTabId = activeTab?.id;
		const tabsToClose = activeTabId ? tabIds.filter((id) => id !== activeTabId) : tabIds;

		if (tabsToClose.length === 0) {
			return { closed: 0, failed: 0, activeProtected: true };
		}

		await chrome.tabs.remove(tabsToClose);

		return {
			closed: tabsToClose.length,
			failed: 0,
			activeProtected: activeTabId !== undefined && tabIds.includes(activeTabId),
		};
	} catch (err) {
		console.error("Failed to close tabs:", err);
		return { closed: 0, failed: tabIds.length, activeProtected: false };
	}
}
