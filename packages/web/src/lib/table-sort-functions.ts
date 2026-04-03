/**
 * Sort functions for TanStack Table columns.
 *
 * Every function implements `SortingFn<unknown>` and guarantees:
 * - Null, undefined, NaN (and type-specific empties) always sort to the END
 *   regardless of sort direction (ascending OR descending).
 * - Standard comparison for non-nullish values.
 *
 * ## How nulls-last works with TanStack Table
 *
 * TanStack Table v8 negates the comparator result for descending sorts:
 *   `desc ? -comparatorResult : comparatorResult`
 *
 * A naive `return 1` for nulls works in ascending (null last) but gets negated
 * to -1 in descending (null first — wrong). To keep nulls last in BOTH
 * directions, we detect the current sort direction from the column state and
 * compensate:
 * - asc + a is null → return +1 (after TanStack: +1 → null last) ✓
 * - desc + a is null → return -1 (after TanStack: -(-1) = +1 → null last) ✓
 */
import type { SortingFn } from '@tanstack/react-table';

// ---------------------------------------------------------------------------
// Direction detection helper
// ---------------------------------------------------------------------------

/**
 * Returns the sort direction for the given column from the row's table state.
 * Falls back to 'asc' if the direction cannot be determined.
 */
function getSortDirection(rowA: { getAllCells: () => { column: { id: string; getIsSorted: () => false | 'asc' | 'desc' } }[] }, columnId: string): 'asc' | 'desc' {
  const cell = rowA.getAllCells().find(c => c.column.id === columnId);
  const dir = cell?.column.getIsSorted();
  return dir === 'desc' ? 'desc' : 'asc';
}

/**
 * Returns the sort value for a nullish row. Always pushes nullish to the end
 * regardless of sort direction.
 *
 * @param isA - true if the nullish value is from rowA, false if from rowB
 */
function nullSortValue(dir: 'asc' | 'desc', isA: boolean): number {
  // If A is null: asc → +1 (A after B), desc → -1 (after TanStack negation → +1)
  // If B is null: asc → -1 (A before B), desc → +1 (after TanStack negation → -1)
  if (isA) return dir === 'desc' ? -1 : 1; // native-ok
  return dir === 'desc' ? 1 : -1; // native-ok
}

// ---------------------------------------------------------------------------
// Type coercion helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Coerce unknown value to a number. Returns NaN for non-numeric values. */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return NaN;
    return Number(trimmed);
  }
  return NaN;
}

/** Coerce unknown value to a timestamp (ms). Returns null for invalid dates. */
export function toTimestamp(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'number') {
    return Number.isNaN(v) ? null : v;
  }
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Coerce unknown value to a trimmed, non-empty string. Returns null for empties. */
export function toSortableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Coerce unknown value to a boolean. Returns null for null/undefined. */
export function toBoolValue(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  return Boolean(v);
}

/**
 * Coerce unknown value to a Decimal-like object with `.comparedTo()` and `.isNaN()`.
 * Uses duck typing so we don't need decimal.js as a direct dependency.
 * Returns null for non-Decimal or NaN Decimal values.
 */
export function toDecimalValue(v: unknown): { comparedTo: (other: unknown) => number } | null {
  if (v === null || v === undefined) return null;
  if (
    typeof v === 'object' &&
    v !== null &&
    'comparedTo' in v && typeof (v as Record<string, unknown>).comparedTo === 'function' &&
    'isNaN' in v && typeof (v as Record<string, unknown>).isNaN === 'function'
  ) {
    const dec = v as { comparedTo: (other: unknown) => number; isNaN: () => boolean };
    return dec.isNaN() ? null : dec;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sort functions
// ---------------------------------------------------------------------------

/**
 * Numeric sort with nulls-last.
 *
 * For currencies, percentages, shares, and any numeric value.
 * Handles `null`, `undefined`, `NaN` → always last.
 * Handles `0` correctly (zero is a valid value, NOT null).
 * Handles negative numbers. Accepts raw numbers or string-encoded numbers.
 */
export const sortNumeric: SortingFn<unknown> = (rowA, rowB, columnId) => {
  const a = toNumber(rowA.getValue(columnId));
  const b = toNumber(rowB.getValue(columnId));
  const aNaN = Number.isNaN(a);
  const bNaN = Number.isNaN(b);

  if (aNaN && bNaN) return 0; // native-ok
  if (aNaN || bNaN) {
    const dir = getSortDirection(rowA, columnId);
    return nullSortValue(dir, aNaN);
  }

  return a - b;
};

/**
 * Date sort with nulls-last.
 *
 * Accepts Date objects, ISO date strings ("2024-01-15"), and numeric
 * timestamps. `null`, `undefined`, and invalid dates → always last.
 * Uses getTime() for comparison (not string comparison).
 */
export const sortDate: SortingFn<unknown> = (rowA, rowB, columnId) => {
  const a = toTimestamp(rowA.getValue(columnId));
  const b = toTimestamp(rowB.getValue(columnId));
  const aNull = a === null;
  const bNull = b === null;

  if (aNull && bNull) return 0; // native-ok
  if (aNull || bNull) {
    const dir = getSortDirection(rowA, columnId);
    return nullSortValue(dir, aNull);
  }

  return a - b;
};

/**
 * Case-insensitive string sort with nulls-last.
 *
 * For names, ISINs, tickers, account names, and any text.
 * `null`, `undefined`, and empty/whitespace-only strings → always last.
 * Trims whitespace before comparison.
 */
export const sortString: SortingFn<unknown> = (rowA, rowB, columnId) => {
  const a = toSortableString(rowA.getValue(columnId));
  const b = toSortableString(rowB.getValue(columnId));
  const aNull = a === null;
  const bNull = b === null;

  if (aNull && bNull) return 0; // native-ok
  if (aNull || bNull) {
    const dir = getSortDirection(rowA, columnId);
    return nullSortValue(dir, aNull);
  }

  return a.localeCompare(b, undefined, { sensitivity: 'base' });
};

/**
 * Boolean sort with nulls-last.
 *
 * `true` sorts before `false` in ascending order.
 * `null`, `undefined` → always last.
 */
export const sortBoolean: SortingFn<unknown> = (rowA, rowB, columnId) => {
  const a = toBoolValue(rowA.getValue(columnId));
  const b = toBoolValue(rowB.getValue(columnId));
  const aNull = a === null;
  const bNull = b === null;

  if (aNull && bNull) return 0; // native-ok
  if (aNull || bNull) {
    const dir = getSortDirection(rowA, columnId);
    return nullSortValue(dir, aNull);
  }

  return (a ? 1 : 0) - (b ? 1 : 0); // native-ok
};

/**
 * Decimal.js sort with nulls-last.
 *
 * Uses `.comparedTo()` method for comparison. Handles `null`, `undefined`,
 * and Decimal NaN → always last. Uses duck typing (no direct decimal.js import).
 */
export const sortDecimalJs: SortingFn<unknown> = (rowA, rowB, columnId) => {
  const a = toDecimalValue(rowA.getValue(columnId));
  const b = toDecimalValue(rowB.getValue(columnId));
  const aNull = a === null;
  const bNull = b === null;

  if (aNull && bNull) return 0; // native-ok
  if (aNull || bNull) {
    const dir = getSortDirection(rowA, columnId);
    return nullSortValue(dir, aNull);
  }

  return a.comparedTo(b);
};
