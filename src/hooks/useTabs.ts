import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChromeTab, DomainGroup } from '../types';
import { groupTabs, clearGroupTabsCache } from '../utils/domainHelpers';
import { getCachedTabs, setCachedTabs, CACHE_TTL, removeExpiredContentCache } from '../utils/cache';

const DEBOUNCE_DELAY = 500; // 500ms debounce for tab events

export function useTabs() {
  const [groups, setGroups] = useState<DomainGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const activeRequestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightFetchRef = useRef<Promise<void> | null>(null);
  const fetchTabsRef = useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    removeExpiredContentCache();
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const fetchTabsImpl = useCallback(async (forceRefresh = false) => {
    const requestId = ++activeRequestIdRef.current;

    const shouldUpdateState = () => {
      return requestId === activeRequestIdRef.current && isMountedRef.current;
    };

    if (!forceRefresh) {
      const cached = await getCachedTabs();
      if (!shouldUpdateState()) return;

      if (cached) {
        setGroups(cached);
        return;
      }
    }

    if (!shouldUpdateState()) return;

    const fetchPromise = (async () => {
      setIsLoading(true);
      setError(null);

    try {
      clearGroupTabsCache();

      const tabs = await chrome.tabs.query({});
      if (!shouldUpdateState()) return;

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

      if (!shouldUpdateState()) return;
      setGroups(grouped);

      await setCachedTabs(grouped);
      } catch (err) {
        if (shouldUpdateState()) {
          setError(err instanceof Error ? err.message : 'Failed to fetch tabs');
        }
      } finally {
        if (shouldUpdateState()) {
          setIsLoading(false);
        }
        if (requestId === activeRequestIdRef.current) {
          inFlightFetchRef.current = null;
        }
      }
    })();

    inFlightFetchRef.current = fetchPromise;
    await fetchPromise;
  }, []);

  fetchTabsRef.current = fetchTabsImpl;

  const fetchTabs = useCallback((forceRefresh?: boolean) => {
    return fetchTabsRef.current?.(forceRefresh);
  }, []);

  useEffect(() => {
    const loadFromCache = async () => {
      const cached = await getCachedTabs();
      if (!isMountedRef.current) return;

      if (cached) {
        setGroups(cached);
        setIsLoading(false);
        return;
      }

      if (isMountedRef.current) {
        fetchTabs();
      }
    };

    loadFromCache();
  }, [fetchTabs]);

  useEffect(() => {
    const CACHE_KEY = 'mimir_cached_tabs';

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'session' && changes[CACHE_KEY]) {
        const newValue = changes[CACHE_KEY].newValue as { data: DomainGroup[]; timestamp: number } | undefined;
        if (newValue && Date.now() - newValue.timestamp < CACHE_TTL) {
          setGroups(newValue.data);
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    const debouncedListener = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (inFlightFetchRef.current) {
          inFlightFetchRef.current.then(() => fetchTabs(true));
        } else {
          fetchTabs(true);
        }
      }, DEBOUNCE_DELAY);
    };

    chrome.tabs.onUpdated.addListener(debouncedListener);
    chrome.tabs.onRemoved.addListener(debouncedListener);
    chrome.tabs.onCreated.addListener(debouncedListener);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      chrome.tabs.onUpdated.removeListener(debouncedListener);
      chrome.tabs.onRemoved.removeListener(debouncedListener);
      chrome.tabs.onCreated.removeListener(debouncedListener);
    };
  }, [fetchTabs]);

  return {
    groups,
    isLoading,
    error,
    refresh: () => fetchTabs(true),
  };
}
