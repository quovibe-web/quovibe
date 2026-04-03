import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { CostTransaction } from '../cost/types';
import { computeFIFO, FIFOResult } from '../cost/fifo';
import { computeMovingAverage } from '../cost/moving-average';
import { computeCurrencyGains } from '../fx/currency-gains';

export interface PeriodGainsResult {
  /** Gain from securities sold within the period, relative to their value at period start */
  realizedGain: Decimal;
  /** Gain from positions still held at period end, relative to their value at period start */
  unrealizedGain: Decimal;
  /** FX-driven component of capital gains (multi-currency; 0 for same-currency positions) */
  foreignCurrencyGains: Decimal;
}

/**
 * Computes capital gains RELATIVE to the start of the reporting period.
 *
 * Calculation Panel behaviour:
 *   Realized Capital Gain = sell_proceeds − value_at_period_start_for_sold_shares
 *   Unrealized Capital Gain = current_value − value_at_period_start_for_held_shares
 *
 * This differs from raw FIFO/MA which computes gains from original purchase price.
 * Here we inject a synthetic "purchase" at period-start market price to represent
 * the existing position, then run FIFO/MA only over in-period activity.
 *
 * Example (from calculation-panel.md, 1-year period):
 *   5 shares sold at 22.40 EUR, value at period start 18.638 EUR/share
 *   → realized = 5 × 22.40 − 5 × 18.638 = 112 − 93.19 = 18.81 EUR ✓
 *
 * Note: foreignCurrencyGains is always Decimal(0) in this implementation.
 *   Multi-currency FX gain calculation requires exchange rate history (future feature).
 */
export function computePeriodRelativeGains(params: {
  /** Total market value of the security at the beginning of the period */
  valueAtPeriodStart: Decimal;
  /** Shares held at the beginning of the period */
  sharesAtPeriodStart: Decimal;
  /** All buy/sell transactions that occurred strictly inside the reporting period */
  inPeriodTransactions: CostTransaction[];
  /** Closing price at the end of the period (for unrealized gain) */
  priceAtPeriodEnd: Decimal;
  /** Shares held at the end of the period */
  sharesAtPeriodEnd: Decimal;
  costMethod: CostMethod;
  /** Optional FX context for multi-currency positions */
  fxContext?: {
    /** foreign→base rate at period start (multiply convention) */
    purchaseRate: Decimal;
    /** foreign→base rate at period end (multiply convention) */
    currentRate: Decimal;
  };
}): PeriodGainsResult {
  const {
    valueAtPeriodStart,
    sharesAtPeriodStart,
    inPeriodTransactions,
    priceAtPeriodEnd,
    costMethod,
  } = params;

  // Create a synthetic "buy" at period start to represent the pre-existing position.
  // Using date '0001-01-01' ensures it always sorts before any real in-period transaction.
  const syntheticBuy: CostTransaction[] = sharesAtPeriodStart.gt(0)
    ? [
        {
          type: 'BUY' as const,
          date: '0001-01-01',
          shares: sharesAtPeriodStart,
          grossAmount: valueAtPeriodStart,
          fees: new Decimal(0),
        },
      ]
    : [];

  const allTxs = [
    ...syntheticBuy,
    ...inPeriodTransactions.sort((a, b) => a.date.localeCompare(b.date)),
  ];

  let result: FIFOResult | ReturnType<typeof computeMovingAverage>;
  if (costMethod === CostMethod.FIFO) {
    result = computeFIFO(allTxs, priceAtPeriodEnd);
  } else {
    result = computeMovingAverage(allTxs, priceAtPeriodEnd);
  }

  return {
    realizedGain: result.realizedGain,
    unrealizedGain: result.unrealizedGain,
    foreignCurrencyGains: params.fxContext
      ? computeCurrencyGains({
          nativeValue: params.sharesAtPeriodEnd.mul(params.priceAtPeriodEnd),
          nativeCost: valueAtPeriodStart,
          purchaseRate: params.fxContext.purchaseRate,
          currentRate: params.fxContext.currentRate,
        }).currencyEffect
      : new Decimal(0),
  };
}
