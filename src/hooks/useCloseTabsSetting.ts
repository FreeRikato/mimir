import { useState, useEffect, useCallback } from 'react';
import { getCloseTabsSetting, setCloseTabsSetting } from '../utils/settings';

interface UseCloseTabsSettingReturn {
  closeTabsEnabled: boolean;
  setCloseTabsEnabled: (value: boolean) => Promise<void>;
  toggleCloseTabs: () => Promise<void>;
}

export function useCloseTabsSetting(): UseCloseTabsSettingReturn {
  const [closeTabsEnabled, setCloseTabsEnabledState] = useState(false);

  // Load initial state from storage
  useEffect(() => {
    let isMounted = true;

    const loadSetting = async () => {
      const stored = await getCloseTabsSetting();
      if (isMounted) {
        setCloseTabsEnabledState(stored);
      }
    };

    loadSetting();

    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for storage changes from other contexts
  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('mimir_close_tabs_enabled' in changes) {
        const newValue = changes.mimir_close_tabs_enabled.newValue;
        if (typeof newValue === 'boolean') {
          setCloseTabsEnabledState(newValue);
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const setCloseTabsEnabled = useCallback(async (value: boolean) => {
    await setCloseTabsSetting(value);
    setCloseTabsEnabledState(value);
  }, []);

  const toggleCloseTabs = useCallback(async () => {
    const newValue = !closeTabsEnabled;
    await setCloseTabsEnabled(newValue);
  }, [closeTabsEnabled, setCloseTabsEnabled]);

  return {
    closeTabsEnabled,
    setCloseTabsEnabled,
    toggleCloseTabs,
  };
}
