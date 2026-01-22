const CLOSE_TABS_KEY = 'mimir_close_tabs_enabled';
const DEFAULT_CLOSE_TABS = false;

export async function getCloseTabsSetting(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([CLOSE_TABS_KEY]);
    const value = result[CLOSE_TABS_KEY];
    return typeof value === 'boolean' ? value : DEFAULT_CLOSE_TABS;
  } catch (err) {
    console.error('Failed to get close tabs setting:', err);
    return DEFAULT_CLOSE_TABS;
  }
}

export async function setCloseTabsSetting(value: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [CLOSE_TABS_KEY]: value });
  } catch (err) {
    console.error('Failed to save close tabs setting:', err);
  }
}
