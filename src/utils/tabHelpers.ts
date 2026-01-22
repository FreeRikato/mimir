import type { ChromeTab } from '../types';

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
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('edge://') &&
        !tab.url.startsWith('about:')
    );

    return tabsToRight.map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      title: tab.title || 'Untitled',
      url: tab.url,
      favIconUrl: tab.favIconUrl,
    }));
  } catch (error) {
    console.error('Failed to get tabs to right:', error);
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
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.startsWith('edge://') &&
          !tab.url.startsWith('about:')
      )
      .map((tab) => ({
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title || 'Untitled',
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        highlighted: tab.highlighted,
        active: tab.active,
      }));
  } catch (error) {
    console.error('Failed to get highlighted tabs:', error);
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
