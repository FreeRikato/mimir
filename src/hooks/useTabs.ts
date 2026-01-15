import { useState, useEffect, useCallback } from 'react';
import type { ChromeTab, DomainGroup } from '../types';
import { groupTabs } from '../utils/domainHelpers';

export function useTabs() {
  const [groups, setGroups] = useState<DomainGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTabs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const tabs = await chrome.tabs.query({});
      
      // Filter valid tabs (must have id and url)
      const validTabs: ChromeTab[] = tabs
        .filter((tab): tab is chrome.tabs.Tab & { id: number; url: string } => 
          tab.id !== undefined && 
          tab.url !== undefined &&
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.startsWith('edge://') &&
          !tab.url.startsWith('about:')
        )
        .map((tab) => ({
          id: tab.id,
          title: tab.title || 'Untitled',
          url: tab.url,
          favIconUrl: tab.favIconUrl,
        }));

      const grouped = groupTabs(validTabs);
      setGroups(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tabs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTabs();
  }, [fetchTabs]);

  return {
    groups,
    isLoading,
    error,
    refresh: fetchTabs,
  };
}
