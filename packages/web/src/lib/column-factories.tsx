/**
 * Column type factories for TanStack Table.
 *
 * Each factory returns a partial ColumnDef with type-appropriate defaults:
 * sort function, alignment, and data type metadata. They do NOT define
 * `accessorFn`, `accessorKey`, `header`, or `id` — those are per-column.
 *
 * Usage:
 * ```ts
 * {
 *   accessorKey: 'marketValue',
 *   header: 'Market Value',
 *   ...currencyColumnMeta(),
 *   cell: ({ row }) => <CurrencyDisplay value={...} />,
 * }
 * ```
 *
 * Factories accept an optional overrides object for customization:
 * ```ts
 * ...numericColumnMeta({ minSize: 120 })
 * ```
 */
import type { ColumnDef } from '@tanstack/react-table';
import { sortNumeric, sortDate, sortString, sortBoolean } from '@/lib/table-sort-functions';

// ---------------------------------------------------------------------------
// Column meta type (extends TanStack Table's meta)
// ---------------------------------------------------------------------------

/** Alignment for header and cell content. */
export type ColumnAlign = 'left' | 'right' | 'center';

/** Data type hint for the column (used for formatting, export, etc.). */
export type ColumnDataType = 'numeric' | 'currency' | 'percent' | 'shares' | 'date' | 'text' | 'boolean';

/** Responsive column priority for auto-hide on smaller viewports. */
export type ColumnPriority = 'high' | 'medium' | 'low';

export interface ColumnTypeMeta {
  align?: ColumnAlign;
  dataType?: ColumnDataType;
  /** Responsive priority: high=always, medium=tablet+, low=desktop only */
  priority?: ColumnPriority;
  /** Existing meta properties pass through */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Override type
// ---------------------------------------------------------------------------

type ColumnFactoryOverrides = Partial<Pick<ColumnDef<unknown, unknown>,
  'size' | 'minSize' | 'maxSize' | 'enableSorting' | 'enableResizing'
>> & {
  /** Responsive priority: high=always, medium=tablet+, low=desktop only */
  priority?: ColumnPriority;
};

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Defaults for generic numeric columns (amounts, counts, ratios).
 * Sort: numeric with nulls-last. Align: right.
 */
export function numericColumnMeta(overrides?: ColumnFactoryOverrides): Partial<ColumnDef<unknown, unknown>> {
  const { priority, ...rest } = overrides ?? {};
  return {
    sortingFn: sortNumeric,
    meta: { align: 'right', dataType: 'numeric', ...(priority && { priority }) } as ColumnTypeMeta,
    ...rest,
  };
}

/**
 * Defaults for currency columns (market value, gains, fees, etc.).
 * Sort: numeric with nulls-last. Align: right.
 */
export function currencyColumnMeta(overrides?: ColumnFactoryOverrides): Partial<ColumnDef<unknown, unknown>> {
  const { priority, ...rest } = overrides ?? {};
  return {
    sortingFn: sortNumeric,
    meta: { align: 'right', dataType: 'currency', ...(priority && { priority }) } as ColumnTypeMeta,
    ...rest,
  };
}

/**
 * Defaults for percentage columns (TTWROR, IRR, allocation %).
 * Sort: numeric with nulls-last. Align: right.
 */
export function percentColumnMeta(overrides?: ColumnFactoryOverrides): Partial<ColumnDef<unknown, unknown>> {
  const { priority, ...rest } = overrides ?? {};
  return {
    sortingFn: sortNumeric,
    meta: { align: 'right', dataType: 'percent', ...(priority && { priority }) } as ColumnTypeMeta,
    ...rest,
  };
}

/**
 * Defaults for date columns.
 * Sort: date with nulls-last (uses getTime(), not string comparison). Align: left.
 */
export function dateColumnMeta(overrides?: ColumnFactoryOverrides): Partial<ColumnDef<unknown, unknown>> {
  const { priority, ...rest } = overrides ?? {};
  return {
    sortingFn: sortDate,
    meta: { align: 'left', dataType: 'date', ...(priority && { priority }) } as ColumnTypeMeta,
    ...rest,
  };
}

/**
 * Defaults for shares columns.
 * Sort: numeric with nulls-last. Align: right.
 */
export function sharesColumnMeta(overrides?: ColumnFactoryOverrides): Partial<ColumnDef<unknown, unknown>> {
  const { priority, ...rest } = overrides ?? {};
  return {
    sortingFn: sortNumeric,
    meta: { align: 'right', dataType: 'shares', ...(priority && { priority }) } as ColumnTypeMeta,
    ...rest,
  };
}

/**
 * Defaults for text columns (names, ISINs, tickers, notes).
 * Sort: case-insensitive string with nulls-last. Align: left.
 */
export function textColumnMeta(overrides?: ColumnFactoryOverrides): Partial<ColumnDef<unknown, unknown>> {
  const { priority, ...rest } = overrides ?? {};
  return {
    sortingFn: sortString,
    meta: { align: 'left', dataType: 'text', ...(priority && { priority }) } as ColumnTypeMeta,
    ...rest,
  };
}

/**
 * Defaults for boolean columns.
 * Sort: boolean with nulls-last (false before true ascending). Align: center.
 */
export function booleanColumnMeta(overrides?: ColumnFactoryOverrides): Partial<ColumnDef<unknown, unknown>> {
  const { priority, ...rest } = overrides ?? {};
  return {
    sortingFn: sortBoolean,
    meta: { align: 'center', dataType: 'boolean', ...(priority && { priority }) } as ColumnTypeMeta,
    ...rest,
  };
}
