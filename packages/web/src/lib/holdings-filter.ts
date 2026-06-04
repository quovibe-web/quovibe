export type HoldingsFilter = 'all' | 'held' | 'exited';

/**
 * Slice a security list by current holding, using the per-row `shares`
 * magnitude (a stringified Decimal from the API). `held` keeps strictly
 * positive shares; `exited` is the exact complement (zero, null, or missing);
 * `all` returns the input unchanged. Pure — no I/O, no React.
 */
export function filterByHoldings<T extends { shares?: string | null }>(
  rows: T[],
  mode: HoldingsFilter,
): T[] {
  if (mode === 'all') return rows;
  if (mode === 'held') return rows.filter((r) => parseFloat(r.shares ?? '0') > 0);
  return rows.filter((r) => !(parseFloat(r.shares ?? '0') > 0));
}
