import Decimal from 'decimal.js';
import { CostTransaction } from './types';
import { SplitEvent } from './split';
import { getRateFromMap, type RateMap } from '../fx/rate-map';

/**
 * A single realized SELL slice for moving-average decomposition.
 * Captured at SELL time: `avgPriceAtSell` and `lotRate` are read BEFORE the
 * proportional reduction applied by the SELL.
 *
 * Caller can decompose with:
 *   capital = shares × (sellPrice - avgPriceAtSell) × sellRate
 *   forex   = shares × avgPriceAtSell × (sellRate - lotRate)
 *
 * Both `lotRate` and `sellRate` are optional only on the type to keep the
 * shape forward-compatible; in practice this struct is only emitted when both
 * are present (otherwise the SELL is recorded in `unresolvedSellDates`).
 */
export interface MovingAverageRealizedSlice {
  date: string;
  shares: Decimal;
  avgPriceAtSell: Decimal;
  lotRate?: Decimal;
  sellPrice: Decimal;
  sellRate?: Decimal;
}

export interface MovingAverageResult {
  averagePurchasePrice: Decimal;
  purchaseValue: Decimal;
  realizedGain: Decimal;
  unrealizedGain: Decimal;
  totalShares: Decimal;
  /** Populated when rateMap supplied. Weighted-average sec→base rate over all live shares. */
  weightedAvgRate?: Decimal;
  /**
   * Populated when rateMap supplied AND `unresolvedBuyDates.length === 0`.
   * Suppressed on partial-coverage to force callers to handle the gap explicitly:
   * applying a weighted-avg rate computed over the tracked subset to the full
   * untracked totalCost silently fabricates a costInBase that drifts from the
   * caller's expectation. See sub-phase 3A code review.
   */
  costInBase?: Decimal;
  /**
   * Populated only when rateMap supplied. BUY dates that had no rate entry —
   * those buys contributed to totalCost / totalShares but NOT to
   * weightedRateNumerator / trackedRateShares. Non-empty → `costInBase` is
   * suppressed; caller must resolve the gap (fill rateMap, raise to UI, etc.)
   * before reading derived base-ccy figures.
   */
  unresolvedBuyDates?: string[];
  /**
   * Populated only when rateMap supplied. SELL dates where either the
   * sell-date rate OR the lot-rate side (weighted-avg) was missing. Those
   * SELLs are NOT emitted in `realizedSellSlices` (skipped, not partial).
   */
  unresolvedSellDates?: string[];
  /**
   * Populated only when rateMap supplied. One slice per SELL where both
   * `sellRate` and `lotRate` were resolvable. Caller feeds these into a
   * single-slice `decomposeRealized` call (or an MA-shaped equivalent) to
   * obtain capital / FX split for realized P&L.
   */
  realizedSellSlices?: MovingAverageRealizedSlice[];
}

export interface MovingAverageOptions {
  rateMap?: RateMap;
}

export function computeMovingAverage(
  transactions: CostTransaction[],
  currentPrice?: Decimal,
  splitEvents?: SplitEvent[],
  opts?: MovingAverageOptions,
): MovingAverageResult {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const pendingSplits = splitEvents
    ? [...splitEvents].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  let totalShares = new Decimal(0);
  let totalCost = new Decimal(0);
  let realizedGain = new Decimal(0);
  let appliedSplitIdx = 0;
  const rateMap = opts?.rateMap;
  let weightedRateNumerator = new Decimal(0);
  let trackedRateShares = new Decimal(0);
  const unresolvedBuyDates: string[] | undefined = rateMap ? [] : undefined;
  const unresolvedSellDates: string[] | undefined = rateMap ? [] : undefined;
  const realizedSellSlices: MovingAverageRealizedSlice[] | undefined = rateMap ? [] : undefined;

  for (const tx of sorted) {
    // Apply any split events that occur before or on this transaction's date
    while (
      appliedSplitIdx < pendingSplits.length &&
      pendingSplits[appliedSplitIdx].date <= tx.date
    ) {
      const ratio = pendingSplits[appliedSplitIdx].ratio;
      totalShares = totalShares.mul(ratio);
      trackedRateShares = trackedRateShares.mul(ratio);
      // totalCost is invariant; avgPrice adjusts implicitly
      appliedSplitIdx++;
    }

    if (tx.type === 'BUY' || tx.type === 'DELIVERY_INBOUND') {
      if (tx.shares.lte(0)) {
        throw new Error(`${tx.type} transaction must have positive shares (got ${tx.shares})`);
      }
      totalCost = totalCost.plus(tx.grossAmount).plus(tx.fees);
      totalShares = totalShares.plus(tx.shares);
      if (rateMap) {
        const buyRate = getRateFromMap(rateMap, tx.date);
        if (buyRate) {
          weightedRateNumerator = weightedRateNumerator.plus(tx.shares.mul(buyRate));
          trackedRateShares = trackedRateShares.plus(tx.shares);
        } else {
          unresolvedBuyDates!.push(tx.date);
        }
      }
    } else if (tx.type === 'SELL' || tx.type === 'DELIVERY_OUTBOUND') {
      const avgPrice = totalShares.isZero() ? new Decimal(0) : totalCost.div(totalShares);
      const costBasis = tx.shares.mul(avgPrice);
      realizedGain = realizedGain.plus(tx.grossAmount.minus(costBasis));
      // Capture lotRate (weighted-avg sec→base rate) BEFORE the proportional reduction.
      const lotRateAtSell = rateMap && !trackedRateShares.isZero()
        ? weightedRateNumerator.div(trackedRateShares)
        : undefined;
      if (rateMap) {
        const sellPrice = tx.shares.isZero() ? new Decimal(0) : tx.grossAmount.div(tx.shares);
        const sellRate = getRateFromMap(rateMap, tx.date) ?? undefined;
        if (sellRate && lotRateAtSell) {
          realizedSellSlices!.push({
            date: tx.date,
            shares: tx.shares,
            avgPriceAtSell: avgPrice,
            lotRate: lotRateAtSell,
            sellPrice,
            sellRate,
          });
        } else {
          unresolvedSellDates!.push(tx.date);
        }
      }
      if (!totalShares.isZero()) {
        const fractionSold = tx.shares.div(totalShares);
        weightedRateNumerator = weightedRateNumerator.mul(new Decimal(1).minus(fractionSold));
        trackedRateShares = trackedRateShares.mul(new Decimal(1).minus(fractionSold));
      }
      totalShares = totalShares.minus(tx.shares);
      if (totalShares.lt(0)) {
        throw new Error(`Sold more shares than available: ${tx.shares} sold, only ${totalShares.plus(tx.shares)} held`);
      }
      totalCost = totalShares.mul(avgPrice);
    }
  }

  const averagePurchasePrice = totalShares.isZero()
    ? new Decimal(0)
    : totalCost.div(totalShares);

  const unrealizedGain =
    currentPrice && !totalShares.isZero()
      ? totalShares.mul(currentPrice).minus(totalCost)
      : new Decimal(0);

  const weightedAvgRate = rateMap && !trackedRateShares.isZero()
    ? weightedRateNumerator.div(trackedRateShares)
    : undefined;
  // Suppress costInBase when BUY coverage is incomplete — the weighted-avg rate
  // computed over the tracked subset would silently scale the full untracked
  // totalCost (see sub-phase 3A code review). weightedAvgRate stays as
  // informational so the caller can still surface the partial value.
  const coverageComplete = !unresolvedBuyDates || unresolvedBuyDates.length === 0;
  const costInBase = weightedAvgRate && coverageComplete ? totalCost.mul(weightedAvgRate) : undefined;

  return {
    averagePurchasePrice,
    purchaseValue: totalCost,
    realizedGain,
    unrealizedGain,
    totalShares,
    ...(weightedAvgRate ? { weightedAvgRate } : {}),
    ...(costInBase ? { costInBase } : {}),
    ...(unresolvedBuyDates ? { unresolvedBuyDates } : {}),
    ...(unresolvedSellDates ? { unresolvedSellDates } : {}),
    ...(realizedSellSlices ? { realizedSellSlices } : {}),
  };
}
