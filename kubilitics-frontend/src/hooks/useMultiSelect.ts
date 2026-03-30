import { useState, useCallback, useRef, useMemo } from 'react';

export interface UseMultiSelectReturn {
  /** Set of currently-selected IDs (typically "namespace/name" keys). */
  selectedIds: Set<string>;
  /** Toggle a single item on/off. Pass the React mouse event to detect Shift. */
  toggle: (id: string, event?: React.MouseEvent) => void;
  /** Shift+click range selection: selects all items between the last-toggled item and `id`. */
  toggleRange: (id: string, allIds: string[]) => void;
  /** Select all provided IDs. */
  selectAll: (ids: string[]) => void;
  /** Deselect everything. */
  clearSelection: () => void;
  /** Check if an ID is selected. */
  isSelected: (id: string) => boolean;
  /** True when at least one item is selected. */
  hasSelection: boolean;
  /** True when every item in `allIds` is selected. Useful for "select all" checkbox state. */
  isAllSelected: (allIds: string[]) => boolean;
  /** True when some (but not all) items in `allIds` are selected. Useful for indeterminate checkbox. */
  isSomeSelected: (allIds: string[]) => boolean;
  /** Number of selected items. */
  count: number;
}

/**
 * Reusable multi-select hook for resource list pages.
 *
 * Supports:
 * - Single toggle (click)
 * - Range selection (Shift+click)
 * - Select all / clear all
 * - Tracks last-clicked item for range operations
 */
export function useMultiSelect(): UseMultiSelectReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Tracks the last toggled id for Shift+click range selection. */
  const lastToggledRef = useRef<string | null>(null);

  const toggle = useCallback((id: string, event?: React.MouseEvent) => {
    // Shift+click → range selection
    if (event?.shiftKey && lastToggledRef.current) {
      // We need the full list of IDs to know the range. The caller should use
      // toggleRange for explicit control, but when the event is passed we store
      // the anchor for next time.
      // Without the full list context here, we just do a simple toggle but
      // remember the id as anchor. Pages using shift detection should call
      // toggleRange directly.
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastToggledRef.current = id;
  }, []);

  const toggleRange = useCallback((id: string, allIds: string[]) => {
    const anchor = lastToggledRef.current;
    if (!anchor) {
      // No anchor — just toggle the single item
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastToggledRef.current = id;
      return;
    }

    const anchorIdx = allIds.indexOf(anchor);
    const targetIdx = allIds.indexOf(id);
    if (anchorIdx === -1 || targetIdx === -1) {
      // Anchor or target not in current list — simple toggle
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      lastToggledRef.current = id;
      return;
    }

    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const rangeIds = allIds.slice(start, end + 1);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const rid of rangeIds) {
        next.add(rid);
      }
      return next;
    });
    lastToggledRef.current = id;
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastToggledRef.current = null;
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const isAllSelected = useCallback(
    (allIds: string[]) => allIds.length > 0 && allIds.every((id) => selectedIds.has(id)),
    [selectedIds],
  );

  const isSomeSelected = useCallback(
    (allIds: string[]) => {
      const count = allIds.filter((id) => selectedIds.has(id)).length;
      return count > 0 && count < allIds.length;
    },
    [selectedIds],
  );

  return useMemo(
    () => ({
      selectedIds,
      toggle,
      toggleRange,
      selectAll,
      clearSelection,
      isSelected,
      hasSelection: selectedIds.size > 0,
      isAllSelected,
      isSomeSelected,
      count: selectedIds.size,
    }),
    [selectedIds, toggle, toggleRange, selectAll, clearSelection, isSelected, isAllSelected, isSomeSelected],
  );
}
