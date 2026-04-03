import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { CostTransaction } from '../cost/types';
import { computeFIFO, FIFOResult } from '../cost/fifo';
import { computeMovingAverage, MovingAverageResult } from '../cost/moving-average';

export type PurchaseValueResult = FIFOResult | MovingAverageResult;

/**
 * Computes the Purchase Value of a security for a given reporting period.
 *
 * Rules:
 *   - Transactions BEFORE the period → revalued at market price at period start
 *     (as if the security were purchased at the beginning of the reporting period)
 *   - Transactions INSIDE the period → use actual purchase price (gross + fees)
 *   - Transactions AFTER the period → ignored (Purchase Value = 0)
 *
 * Example (2-year period):
 *   Buy 10 shares on 2021-01-15 (before period start 2021-06-12)
 *   → synthetic buy: 10 × 17.794 = 177.94 EUR at period start
 *   Sell 5 shares → FIFO: 177.94 / 2 = 88.97 remaining
 *   Buy 5 shares for 84 EUR (in period)
 *   → Purchase Value = 88.97 + 84 = 172.97 EUR ✓
 */
export function computePurchaseValue(params: {
  transactions: CostTransaction[];
  costMethod: CostMethod;
  reportingPeriod: { start: string; end: string };
  /** Closing price on the day before period start */
  priceAtPeriodStart: Decimal;
  currentPrice?: Decimal;
}): PurchaseValueResult {
  const { transactions, costMethod, reportingPeriod, priceAtPeriodStart } = params;

  // Step 1: process pre-period transactions to find how many shares were held
  const prePeriodTxs = transactions
    .filter((t) => t.date < reportingPeriod.start)
    .sort((a, b) => a.date.localeCompare(b.date));

  const preResult =
    costMethod === CostMethod.FIFO
      ? computeFIFO(prePeriodTxs)
      : computeMovingAverage(prePeriodTxs);

  // Step 2: derive shares held at period start from the pre-period result
  const prePeriodShares =
    'remainingLots' in preResult
      ? (preResult as FIFOResult).remainingLots.reduce(
          (s, l) => s.plus(l.shares),
          new Decimal(0),
        )
      : (preResult as MovingAverageResult).totalShares;

  // Step 3: create a synthetic buy at period start price to replace pre-period lots
  const syntheticPrePeriod: CostTransaction[] = prePeriodShares.gt(0)
    ? [
        {
          type: 'BUY' as const,
          date: reportingPeriod.start,
          shares: prePeriodShares,
          grossAmount: prePeriodShares.times(priceAtPeriodStart),
          fees: new Decimal(0),
        },
      ]
    : [];

  // Step 4: combine synthetic lot with in-period transactions
  const inPeriodTxs = transactions
    .filter((t) => t.date >= reportingPeriod.start && t.date <= reportingPeriod.end)
    .sort((a, b) => a.date.localeCompare(b.date));

  const allTxs = [...syntheticPrePeriod, ...inPeriodTxs];

  return costMethod === CostMethod.FIFO
    ? computeFIFO(allTxs, params.currentPrice)
    : computeMovingAverage(allTxs, params.currentPrice);
}
