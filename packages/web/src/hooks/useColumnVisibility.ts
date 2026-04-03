import { useMemo, useCallback, useRef, useEffect } from 'react';
import type { VisibilityState } from '@tanstack/react-table';
import type { InvestmentsView } from '@quovibe/shared';

/** Columns that always appear — not toggleable */
export const LOCKED_COLUMNS = ['logo', 'name', 'actions'] as const;

/** Column groups for the grouped picker */
export const COLUMN_GROUPS = {
  position: ['shares', 'pricePerShare', 'marketValue', 'percentage'],
  performance: ['irr', 'ttwror', 'ttwrorPa', 'purchaseValue', 'mve', 'unrealizedGain', 'realizedGain', 'dividends', 'fees', 'taxes'],
  identity: ['isin', 'ticker', 'currency', 'latestQuote', 'latestDate'],
} as const;

export type ColumnGroup = keyof typeof COLUMN_GROUPS;

/** Default visible columns (no presets — single unified table) */
export const DEFAULT_COLUMNS = ['marketValue', 'unrealizedGain', 'ttwror'] as const;

/** All toggleable column IDs (union of all groups) */
export const ALL_COLUMN_IDS = [
  ...COLUMN_GROUPS.position,
  ...COLUMN_GROUPS.performance,
  ...COLUMN_GROUPS.identity,
] as const;

/** Columns that require usePerformanceSecurities data */
export const PERF_COLUMNS = ['irr', 'ttwror', 'ttwrorPa', 'purchaseValue', 'mve', 'unrealizedGain', 'realizedGain', 'dividends', 'fees', 'taxes'] as const;

/** Columns that require useStatementOfAssets data */
export const STATEMENT_COLUMNS = ['pricePerShare', 'marketValue', 'percentage'] as const;

/** Migrate legacy preset-based columns to flat format */
function migrateColumns(columns: InvestmentsView['columns']): string[] {
  if (Array.isArray(columns)) return columns;
  if (typeof columns === 'object' && columns !== null) {
    // Legacy Record<preset, string[]> — merge all preset arrays, deduplicate
    const merged = new Set<string>();
    for (const arr of Object.values(columns)) {
      if (Array.isArray(arr)) arr.forEach(id => merged.add(id));
    }
    return merged.size > 0 ? [...merged] : [...DEFAULT_COLUMNS];
  }
  return [...DEFAULT_COLUMNS];
}

interface UseColumnVisibilityParams {
  savedView: InvestmentsView | undefined;
  onSave: (data: Partial<InvestmentsView>) => void;
}

export function useColumnVisibility({ savedView, onSave }: UseColumnVisibilityParams) {
  // Resolve visible columns: saved customization > defaults
  const visibleColumns = useMemo(() => {
    if (!savedView?.columns) return [...DEFAULT_COLUMNS];
    const migrated = migrateColumns(savedView.columns);
    // Filter out unknown column IDs (forward compat)
    const valid = migrated.filter(id => (ALL_COLUMN_IDS as readonly string[]).includes(id));
    return valid.length > 0 ? valid : [...DEFAULT_COLUMNS];
  }, [savedView]);

  // Build TanStack Table VisibilityState
  const columnVisibility = useMemo<VisibilityState>(() => {
    const state: VisibilityState = {};
    for (const id of ALL_COLUMN_IDS) {
      state[id] = visibleColumns.includes(id);
    }
    // Locked columns always visible
    for (const id of LOCKED_COLUMNS) {
      state[id] = true;
    }
    return state;
  }, [visibleColumns]);

  // Debounced save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const debouncedSave = useCallback((cols: string[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onSave({ columns: cols });
    }, 500);
  }, [onSave]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Toggle a single column
  const toggleColumn = useCallback((columnId: string) => {
    if ((LOCKED_COLUMNS as readonly string[]).includes(columnId)) return;
    const current = [...visibleColumns];
    const idx = current.indexOf(columnId);
    const updated = idx >= 0
      ? current.filter(id => id !== columnId)
      : [...current, columnId];
    debouncedSave(updated);
  }, [visibleColumns, debouncedSave]);

  // Toggle all columns in a group
  const toggleGroup = useCallback((group: ColumnGroup) => {
    const groupCols = COLUMN_GROUPS[group] as readonly string[];
    const current = [...visibleColumns];
    const allVisible = groupCols.every(id => current.includes(id));
    let updated: string[];
    if (allVisible) {
      // Remove all group columns
      updated = current.filter(id => !groupCols.includes(id));
    } else {
      // Add all missing group columns
      const toAdd = groupCols.filter(id => !current.includes(id));
      updated = [...current, ...toAdd];
    }
    debouncedSave(updated);
  }, [visibleColumns, debouncedSave]);

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    onSave({ columns: [...DEFAULT_COLUMNS] });
  }, [onSave]);

  // Derived: which hooks are needed
  const needsPerf = visibleColumns.some(c => (PERF_COLUMNS as readonly string[]).includes(c));
  const needsStatement = visibleColumns.some(c => (STATEMENT_COLUMNS as readonly string[]).includes(c)) || !needsPerf;

  return {
    visibleColumns,
    columnVisibility,
    toggleColumn,
    toggleGroup,
    resetToDefaults,
    needsPerf,
    needsStatement,
    visibleCount: visibleColumns.length,
  };
}
