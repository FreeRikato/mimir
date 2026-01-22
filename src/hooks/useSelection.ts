import { useState, useCallback, useMemo } from 'react';
import type { DomainGroup } from '../types';

export type SelectionState = boolean | 'indeterminate';

export function useSelection() {
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());

  const isTabSelected = useCallback(
    (id: number): boolean => selectedTabIds.has(id),
    [selectedTabIds]
  );

  const getDomainSelectionState = useCallback(
    (group: DomainGroup): SelectionState => {
      let selectedCount = 0;
      for (const tab of group.tabs) {
        if (selectedTabIds.has(tab.id)) {
          selectedCount++;
        }
      }

      if (selectedCount === 0) return false;
      if (selectedCount === group.tabs.length) return true;
      return 'indeterminate';
    },
    [selectedTabIds]
  );

  const toggleTab = useCallback((id: number) => {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleDomain = useCallback((group: DomainGroup) => {
    const state = getDomainSelectionState(group);

    setSelectedTabIds((prev) => {
      const next = new Set(prev);

      if (state === true) {
        for (const tab of group.tabs) {
          next.delete(tab.id);
        }
      } else {
        for (const tab of group.tabs) {
          next.add(tab.id);
        }
      }

      return next;
    });
  }, [getDomainSelectionState]);

  const clearSelection = useCallback(() => {
    setSelectedTabIds(new Set());
  }, []);

  const selectedCount = useMemo(() => selectedTabIds.size, [selectedTabIds]);

  const getSelectedIdsAsArray = useCallback(() => Array.from(selectedTabIds), [selectedTabIds]);

  return {
    selectedTabIds,
    selectedCount,
    getSelectedIdsAsArray,
    isTabSelected,
    getDomainSelectionState,
    toggleTab,
    toggleDomain,
    clearSelection,
  };
}
