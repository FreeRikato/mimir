import { useState, useEffect, useCallback } from 'react';
import type { ChromeTab, DomainGroup } from '../types';
import { groupTabs } from '../utils/domainHelpers';

const CACHE_KEY = 'mimir_cached_tabs';
const CACHE_TTL = 30000; // 30 seconds

export function useTabs() {
  const [groups, setGroups] = useState<DomainGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTabs = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      try {
        const cached = await chrome.storage.session.get([CACHE_KEY]);
        const cacheEntry = cached[CACHE_KEY] as { data: DomainGroup[]; timestamp: number } | undefined;
        if (cacheEntry) {
          const { data, timestamp } = cacheEntry;
          if (Date.now() - timestamp < CACHE_TTL) {
            setGroups(data);
            return;
          }
        }
      } catch (err) {
        // Cache read failed, continue with fresh fetch
        console.warn('Failed to load tabs from cache:', err);
      }
    }

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
          windowId: tab.windowId,
          title: tab.title || 'Untitled',
          url: tab.url,
          favIconUrl: tab.favIconUrl,
        }));

      const grouped = groupTabs(validTabs);
      setGroups(grouped);
      
      // Update cache
      await chrome.storage.session.set({
        [CACHE_KEY]: {
          data: grouped,
          timestamp: Date.now()
        }
      });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tabs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load from cache immediately on mount
  useEffect(() => {
    const loadFromCache = async () => {
      try {
        const cached = await chrome.storage.session.get([CACHE_KEY]);
        const cacheEntry = cached[CACHE_KEY] as { data: DomainGroup[]; timestamp: number } | undefined;
        if (cacheEntry) {
          const { data, timestamp } = cacheEntry;
          if (Date.now() - timestamp < CACHE_TTL) {
            setGroups(data);
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        // Cache read failed, continue with fresh fetch
        console.warn('Failed to load tabs from cache:', err);
      }
      // If cache miss or expired, fetch fresh data
      fetchTabs();
    };
    
    loadFromCache();
  }, [fetchTabs]);

  // Listen for tab updates to auto-refresh cache
  useEffect(() => {
    const listener = () => fetchTabs(true); // Force refresh on changes
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(listener);
    chrome.tabs.onCreated.addListener(listener);
    
    return () => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(listener);
      chrome.tabs.onCreated.removeListener(listener);
    };
  }, [fetchTabs]);

  return {
    groups,
    isLoading,
    error,
    refresh: () => fetchTabs(true),
  };
}
