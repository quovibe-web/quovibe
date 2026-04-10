import { useCallback, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SortingState, VisibilityState, ColumnSizingState, ColumnOrderState } from '@tanstack/react-table';
import { apiFetch } from './fetch';
import type { TableLayoutEntry } from '@quovibe/shared';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const layoutKeys = {
  all: ['settings', 'table-layouts'] as const,
  one: (tableId: string) => ['settings', 'table-layouts', tableId] as const,
};

// ---------------------------------------------------------------------------
// Defaults contract — caller provides defaults for their table
// ---------------------------------------------------------------------------

export interface TableLayoutDefaults {
  sorting: SortingState;
  columnSizing: ColumnSizingState;
  columnOrder: ColumnOrderState;
  columnVisibility: VisibilityState;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseTableLayoutReturn {
  /** Current sorting state (persisted or default) */
  sorting: SortingState;
  /** Current column sizing (persisted or default) */
  columnSizing: ColumnSizingState;
  /** Current column order (persisted or default) */
  columnOrder: ColumnOrderState;
  /** Current column visibility (persisted or default) */
  columnVisibility: VisibilityState;
  /** True while the initial load is in progress */
  isLoading: boolean;

  /** Save sorting state (immediate) */
  setSorting: (sorting: SortingState) => void;
  /** Save column sizing (debounced 300ms) */
  setColumnSizing: (sizing: ColumnSizingState) => void;
  /** Save column order (immediate) */
  setColumnOrder: (order: ColumnOrderState) => void;
  /** Save column visibility (immediate) */
  setColumnVisibility: (visibility: VisibilityState) => void;
  /** Reset all state to defaults (deletes persisted layout) */
  resetAll: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useTableLayout(
  tableId: string,
  defaults: TableLayoutDefaults,
): UseTableLayoutReturn {
  const queryClient = useQueryClient();
  const queryKey = layoutKeys.one(tableId);

  // --- Load persisted state ---
  const isEnabled = !tableId.startsWith('__');
  const { data: persisted, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiFetch<TableLayoutEntry>(`/api/settings/table-layouts/${tableId}`),
    staleTime: Infinity,
    retry: false,
    enabled: isEnabled,
  });

  // --- Merge persisted with defaults ---
  const sorting = persisted?.sorting ?? defaults.sorting;
  const columnSizing = (persisted?.columnSizing && Object.keys(persisted.columnSizing).length > 0)
    ? persisted.columnSizing
    : defaults.columnSizing;
  const columnOrder = (persisted?.columnOrder && persisted.columnOrder.length > 0)
    ? persisted.columnOrder
    : defaults.columnOrder;
  const columnVisibility = persisted?.columnVisibility ?? defaults.columnVisibility;

  // --- Save mutation ---
  const saveMutation = useMutation({
    mutationFn: (data: Partial<TableLayoutEntry>) =>
      apiFetch<TableLayoutEntry>(`/api/settings/table-layouts/${tableId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<TableLayoutEntry>(queryKey);
      queryClient.setQueryData<TableLayoutEntry>(queryKey, (old) => {
        const base = old ?? {
          columnOrder: defaults.columnOrder,
          columnSizing: defaults.columnSizing,
          sorting: defaults.sorting,
          columnVisibility: defaults.columnVisibility,
          version: 1,
        };
        return {
          ...base,
          ...newData,
          // Merge columnSizing rather than replace
          columnSizing: newData.columnSizing !== undefined
            ? { ...base.columnSizing, ...newData.columnSizing }
            : base.columnSizing,
        };
      });
      return { prev };
    },
    onError: (_err, _data, context) => {
      if (context?.prev) {
        queryClient.setQueryData(queryKey, context.prev);
      }
    },
  });

  // --- Delete mutation (for reset) ---
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>(`/api/settings/table-layouts/${tableId}`, {
        method: 'DELETE',
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<TableLayoutEntry>(queryKey);
      // Set to "empty" layout so merge logic immediately falls back to caller defaults.
      // Do NOT set to undefined — that would trigger an auto-refetch that could race with DELETE.
      queryClient.setQueryData<TableLayoutEntry>(queryKey, {
        sorting: null,
        columnVisibility: null,
        columnSizing: {},
        columnOrder: [],
        version: 1,
      });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.prev);
    },
  });

  // --- Debounced sizing save ---
  const sizingTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingSizingRef = useRef<ColumnSizingState | null>(null);

  useEffect(() => () => {
    if (sizingTimerRef.current) clearTimeout(sizingTimerRef.current);
  }, []);

  const setColumnSizing = useCallback((sizing: ColumnSizingState) => {
    // Optimistic update immediately
    queryClient.setQueryData<TableLayoutEntry>(queryKey, (old) => {
      const base = old ?? {
        columnOrder: defaults.columnOrder,
        columnSizing: defaults.columnSizing,
        sorting: defaults.sorting,
        columnVisibility: defaults.columnVisibility,
        version: 1,
      };
      return { ...base, columnSizing: { ...base.columnSizing, ...sizing } };
    });

    // Debounce the API save
    pendingSizingRef.current = sizing;
    if (sizingTimerRef.current) clearTimeout(sizingTimerRef.current);
    sizingTimerRef.current = setTimeout(() => {
      if (pendingSizingRef.current) {
        saveMutation.mutate({ columnSizing: pendingSizingRef.current });
        pendingSizingRef.current = null;
      }
    }, 300);
  }, [queryClient, queryKey, defaults, saveMutation]);

  // --- Immediate saves ---
  const setSorting = useCallback((newSorting: SortingState) => {
    saveMutation.mutate({ sorting: newSorting });
  }, [saveMutation]);

  const setColumnOrder = useCallback((order: ColumnOrderState) => {
    saveMutation.mutate({ columnOrder: order });
  }, [saveMutation]);

  const setColumnVisibility = useCallback((visibility: VisibilityState) => {
    saveMutation.mutate({ columnVisibility: visibility });
  }, [saveMutation]);

  const resetAll = useCallback(() => {
    deleteMutation.mutate();
  }, [deleteMutation]);

  return {
    sorting,
    columnSizing,
    columnOrder,
    columnVisibility,
    isLoading,
    setSorting,
    setColumnSizing,
    setColumnOrder,
    setColumnVisibility,
    resetAll,
  };
}
