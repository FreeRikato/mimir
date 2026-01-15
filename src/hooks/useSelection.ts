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
      const tabIds = group.tabs.map((t) => t.id);
      const selectedCount = tabIds.filter((id) => selectedTabIds.has(id)).length;

      if (selectedCount === 0) return false;
      if (selectedCount === tabIds.length) return true;
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
    const tabIds = group.tabs.map((t) => t.id);
    const state = getDomainSelectionState(group);

    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      
      if (state === true) {
        // All selected -> deselect all
        for (const id of tabIds) {
          next.delete(id);
        }
      } else {
        // None or some selected -> select all
        for (const id of tabIds) {
          next.add(id);
        }
      }
      
      return next;
    });
  }, [getDomainSelectionState]);

  const clearSelection = useCallback(() => {
    setSelectedTabIds(new Set());
  }, []);

  const selectedCount = useMemo(() => selectedTabIds.size, [selectedTabIds]);

  const selectedIds = useMemo(() => Array.from(selectedTabIds), [selectedTabIds]);

  return {
    selectedTabIds,
    selectedCount,
    selectedIds,
    isTabSelected,
    getDomainSelectionState,
    toggleTab,
    toggleDomain,
    clearSelection,
  };
}
