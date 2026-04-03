// packages/engine/src/fx/rate-map.ts
import Decimal from 'decimal.js';
import { addDays, format, parseISO, differenceInCalendarDays } from 'date-fns';

/**
 * Map<isoDate, Decimal> — exchange rate for each day, single currency pair.
 * Uses multiply convention: foreignAmount × rate = baseAmount.
 */
export type RateMap = Map<string, Decimal>;

/**
 * Direct lookup — returns the rate for the exact date or null.
 */
export function getRateFromMap(map: RateMap, date: string): Decimal | null {
  return map.get(date) ?? null;
}

/**
 * Takes a sparse RateMap (only days with real ECB data) and fills gaps
 * using the last known rate (forward-fill).
 *
 * ECB publishes rates on business days only. No interpolation is applied;
 * the last known rate is carried forward.
 *
 * No backward-fill: dates before the first known data point get no entry.
 * This matches carryForwardPrices behavior in ttwror.ts.
 */
export function buildForwardFilledMap(
  sparseMap: RateMap,
  startDate: string,
  endDate: string,
): RateMap {
  if (sparseMap.size === 0) return new Map();

  const filled: RateMap = new Map();
  const totalDays = differenceInCalendarDays(parseISO(endDate), parseISO(startDate));

  let lastKnownRate: Decimal | null = null;

  // Check for rates before startDate (to seed forward-fill)
  const sortedEntries = [...sparseMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [date, rate] of sortedEntries) {
    if (date <= startDate) lastKnownRate = rate;
    else break;
  }

  for (let i = 0; i <= totalDays; i++) {
    const date = format(addDays(parseISO(startDate), i), 'yyyy-MM-dd');
    const exactRate = sparseMap.get(date);
    if (exactRate !== undefined) {
      lastKnownRate = exactRate;
    }
    if (lastKnownRate !== null) {
      filled.set(date, lastKnownRate);
    }
  }

  return filled;
}
