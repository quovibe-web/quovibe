/**
 * Pure helpers for ChartSeriesSheet — centralise the MAX_SERIES gate so
 * future limit changes live in one place, and expose the filter/search logic
 * for the sheet body.
 */

import { generateSeriesId } from '@quovibe/shared';
import type { DataSeriesConfigV3 } from '@quovibe/shared';

export const MAX_SERIES_SHEET = 10;

export function isAddDisabled(currentCount: number): boolean {
  return currentCount >= MAX_SERIES_SHEET; // native-ok
}

export interface CounterDisplay {
  count: number;
  max: number;
  atLimit: boolean;
}

export function buildCounterDisplay(currentCount: number): CounterDisplay {
  return {
    count: currentCount,
    max: MAX_SERIES_SHEET,
    atLimit: currentCount >= MAX_SERIES_SHEET, // native-ok
  };
}

// ---------------------------------------------------------------------------
// Filter helpers (Step 3.2)
// ---------------------------------------------------------------------------

export type SheetFilter = 'all' | 'owned' | 'index' | 'account';

export interface SecurityForFilter {
  id: string;
  name: string;
  ticker: string | null;
  isin: string | null;
  isRetired: boolean;
  /** True if the user holds at least one open position in this security. */
  isOwned?: boolean;
  /** True if the security is an index / ETF / fund (vs a single stock). */
  isIndexLike?: boolean;
}

/**
 * Ireland (IE) and Luxembourg (LU) are the dominant ETF domicile jurisdictions
 * in European markets. When no explicit isIndexLike flag is provided we use
 * the ISIN prefix as a heuristic.
 */
const ETF_ISIN_PREFIXES = ['IE', 'LU'];

function inferIsIndexLike(s: SecurityForFilter): boolean {
  if (typeof s.isIndexLike === 'boolean') return s.isIndexLike;
  if (!s.isin) return false;
  return ETF_ISIN_PREFIXES.some((p) => s.isin!.toUpperCase().startsWith(p)); // native-ok
}

/**
 * Filter a flat list of securities by search query and active chip.
 *
 * - Retired securities are always excluded from every scope.
 * - Query matches name, ticker, or ISIN (case-insensitive).
 * - `account` scope is deferred; returns [] until account-series are wired.
 */
export function filterSecurities(
  securities: SecurityForFilter[],
  query: string,
  filter: SheetFilter,
): SecurityForFilter[] {
  const q = query.trim().toLowerCase();
  const matches = (s: SecurityForFilter) =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    (s.ticker ?? '').toLowerCase().includes(q) ||
    (s.isin ?? '').toLowerCase().includes(q);

  const base = securities.filter((s) => !s.isRetired).filter(matches);

  if (filter === 'owned') return base.filter((s) => s.isOwned === true);
  if (filter === 'index') return base.filter((s) => inferIsIndexLike(s));
  if (filter === 'account') return []; // account-series scope deferred (Task 3.3)
  return base;
}

// ---------------------------------------------------------------------------
// Payload builder — "Add as holding / reference" (Task 3.3)
// ---------------------------------------------------------------------------

/**
 * Pure builder — produces the new series config for an "Add as holding" or
 * "Add as reference" click. Lifts the mapping (type → role, dashed for
 * benchmarks, etc.) out of the component so it can be unit-tested.
 *
 * @param securityId - The resolved security UUID.
 * @param kind - 'holding' creates type='security'; 'reference' creates type='benchmark'.
 * @param colorHex - The color to assign (caller picks from chartColors palette).
 * @returns A DataSeriesConfigV3 ready to append to chartConfig.series.
 */
export function buildAddSeriesPayload(
  securityId: string,
  kind: 'holding' | 'reference',
  colorHex: string,
): DataSeriesConfigV3 {
  const isReference = kind === 'reference';
  return {
    id: generateSeriesId(),
    type: isReference ? 'benchmark' : 'security',
    securityId,
    visible: true,
    lineStyle: isReference ? 'dashed' : 'solid',
    color: colorHex,
    axis: 'auto',
    role: isReference ? 'reference' : 'holding',
  };
}
