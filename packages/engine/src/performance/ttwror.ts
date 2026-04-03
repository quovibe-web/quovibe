import Decimal from 'decimal.js';
import { eachDayOfInterval, parseISO, format } from 'date-fns';
import { Cashflow } from '@quovibe/shared';

export interface DailySnapshot {
  date: string;
  mve: Decimal;   // Market Value End of day
  cfIn: Decimal;  // Cash inflows (start of day), ≥ 0
  cfOut: Decimal; // Cash outflows (end of day), ≥ 0
}

export interface TTWRORResult {
  cumulative: Decimal;
  annualized: Decimal;
  dailyReturns: Array<{ date: string; r: Decimal; cumR: Decimal }>;
}

/**
 * Fills price gaps (weekends, holidays) with the last known price.
 * Days before the first known price produce no entry (market value = 0).
 */
export function carryForwardPrices(
  prices: Map<string, Decimal>,
  startDate: string,
  endDate: string,
): Map<string, Decimal> {
  let lastKnownPrice: Decimal | null = null;
  const result = new Map<string, Decimal>();

  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate),
  });

  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    const price = prices.get(dateStr);
    if (price !== undefined) {
      lastKnownPrice = price;
    }
    if (lastKnownPrice !== null) {
      result.set(dateStr, lastKnownPrice);
    }
    // Days before first known price: no entry → market value = 0
  }

  if (lastKnownPrice === null) {
    console.warn(
      `[ttwror] carryForwardPrices: no price data found for ${startDate}..${endDate}`,
    );
  }

  return result;
}

/**
 * Builds daily snapshots for each day in the period.
 *
 * @param cashflows  Signed cashflows (positive = inflow, negative = outflow).
 * @param marketValues  Map<date, marketValue> — pre-computed total market value per day.
 *   Days without an entry default to 0. Use carryForwardPrices to fill gaps beforehand.
 * @param period  Reporting period dates (inclusive).
 */
export function buildDailySnapshots(
  cashflows: Cashflow[],
  marketValues: Map<string, Decimal>,
  period: { start: string; end: string },
): DailySnapshot[] {
  // Group cashflows by date for O(1) lookup
  const cfByDate = new Map<string, { cfIn: Decimal; cfOut: Decimal }>();
  for (const cf of cashflows) {
    const entry = cfByDate.get(cf.date) ?? { cfIn: new Decimal(0), cfOut: new Decimal(0) };
    if (cf.amount.gt(0)) {
      entry.cfIn = entry.cfIn.plus(cf.amount);
    } else {
      entry.cfOut = entry.cfOut.plus(cf.amount.negated()); // store as positive
    }
    cfByDate.set(cf.date, entry);
  }

  const days = eachDayOfInterval({
    start: parseISO(period.start),
    end: parseISO(period.end),
  });

  const snapshots: DailySnapshot[] = [];
  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    const mve = marketValues.get(dateStr) ?? new Decimal(0);
    const cf = cfByDate.get(dateStr);
    snapshots.push({
      date: dateStr,
      mve,
      cfIn: cf ? cf.cfIn : new Decimal(0),
      cfOut: cf ? cf.cfOut : new Decimal(0),
    });
  }

  return snapshots;
}

/**
 * Convenience wrapper: carries forward prices, then builds daily snapshots.
 * Useful when raw market values have gaps (weekends, holidays).
 */
export function buildDailySnapshotsWithCarry(
  cashflows: Cashflow[],
  rawMarketValues: Map<string, Decimal>,
  period: { start: string; end: string },
): DailySnapshot[] {
  const filled = carryForwardPrices(rawMarketValues, period.start, period.end);
  return buildDailySnapshots(cashflows, filled, period);
}

/**
 * Computes the True Time-Weighted Rate of Return (TTWROR).
 *
 * TTWROR daily holding period formula:
 *   1 + r = (MVE + CFout) / (MVB + CFin)
 *
 * CFin  = inflows at start of day (≥ 0)
 * CFout = outflows at end of day (≥ 0)
 */
export function computeTTWROR(
  snapshots: DailySnapshot[],
  periodDays: number,
): TTWRORResult {
  const ONE = new Decimal(1);
  const dailyReturns: Array<{ date: string; r: Decimal; cumR: Decimal }> = [];
  let cumulativeProduct = ONE;

  for (let i = 1; i < snapshots.length; i++) {
    const mvb = snapshots[i - 1].mve;
    const mve = snapshots[i].mve;
    const cfIn = snapshots[i].cfIn;
    const cfOut = snapshots[i].cfOut;

    const denominator = mvb.plus(cfIn);
    // If denominator ≤ 0 (no capital or negative capital base), daily factor = 1 (r = 0).
    // A negative denominator would invert the sign of the factor, producing nonsensical results.
    const dailyFactor = denominator.lte(0) ? ONE : mve.plus(cfOut).div(denominator);

    cumulativeProduct = cumulativeProduct.times(dailyFactor);

    dailyReturns.push({
      date: snapshots[i].date,
      r: dailyFactor.minus(ONE),
      cumR: cumulativeProduct.minus(ONE),
    });
  }

  const cumulative = cumulativeProduct.minus(ONE);

  // TTWROR p.a.: (1 + r_cum) ^ (365 / periodDays) - 1
  const annualized =
    periodDays > 0
      ? cumulativeProduct.pow(new Decimal(365).div(periodDays)).minus(ONE)
      : new Decimal(0);

  return { cumulative, annualized, dailyReturns };
}
