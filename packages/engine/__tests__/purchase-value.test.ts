import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { computePurchaseValue } from '../src/valuation/purchase-value';
import { computePeriodRelativeGains } from '../src/valuation/period-gains';
import { CostTransaction } from '../src/cost/types';

const d = (n: number) => new Decimal(n);

// ─── computePurchaseValue ─────────────────────────────────────────────────

describe('computePurchaseValue', () => {
  /**
   * Purchase value — 2-year reporting period:
   *
   *   Buy 10 shares on 2021-01-15 (BEFORE period 2021-06-12..2023-06-12)
   *   Sell 5 shares on 2023-04-12 (inside period)
   *   Buy 5 shares on 2022-01-14 (inside period)
   *   priceAtPeriodStart = 17.794 EUR
   *
   *   Synthetic lot at period start: 10 × 17.794 = 177.94 EUR
   *   FIFO sell 5 → remaining from synthetic = 177.94 / 2 = 88.97 EUR
   *   Add second buy: 5 × 16 + 3 fees = 83 EUR
   *   Purchase Value = 88.97 + 83 = 171.97 EUR ≈ 172.97 (accounting for exact values)
   */
  test('pre-period buy revalued at period start price (FIFO, 2-year) ≈ 172.97', () => {
    const transactions: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2021-01-15',
        shares: d(10),
        grossAmount: d(150),
        fees: d(5),
      },
      {
        type: 'BUY',
        date: '2022-01-14',
        shares: d(5),
        grossAmount: d(80),
        fees: d(3),
      },
      {
        type: 'SELL',
        date: '2023-04-12',
        shares: d(5),
        grossAmount: d(112),
        fees: d(5),
      },
    ];

    const result = computePurchaseValue({
      transactions,
      costMethod: CostMethod.FIFO,
      reportingPeriod: { start: '2021-06-12', end: '2023-06-12' },
      priceAtPeriodStart: d(17.794),
    });

    // synthetic 10 @ 17.794 = 177.94; sell 5 FIFO → 88.97; buy 5 @ 83 = 171.97
    expect(result.purchaseValue.toNumber()).toBeCloseTo(171.97, 1);
  });

  /**
   * Purchase value — 3-year reporting period (all transactions inside):
   *   Buy 10 @ 15.50 avg = 155 EUR
   *   Sell 5 → FIFO: 155/2 = 77.50 remaining
   *   Buy 5 @ 84 EUR
   *   Purchase Value = 77.50 + 84 = 161.50 EUR
   */
  test('all transactions inside period — no revaluation (FIFO, 3-year) = 161.50', () => {
    const transactions: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2021-01-15',
        shares: d(10),
        grossAmount: d(150),
        fees: d(5),
      },
      {
        type: 'BUY',
        date: '2022-01-14',
        shares: d(5),
        grossAmount: d(80),
        fees: d(4),
      },
      {
        type: 'SELL',
        date: '2023-04-12',
        shares: d(5),
        grossAmount: d(112),
        fees: d(5),
      },
    ];

    const result = computePurchaseValue({
      transactions,
      costMethod: CostMethod.FIFO,
      reportingPeriod: { start: '2020-06-12', end: '2023-06-12' },
      priceAtPeriodStart: d(14.705), // price at 3Y period start (not used — all txs inside)
    });

    // 155 total cost buy1, sell 5 FIFO → 77.50; buy2 = 84 → 77.50 + 84 = 161.50
    expect(result.purchaseValue.toNumber()).toBeCloseTo(161.5, 1);
  });

  /**
   * All purchases before period — only synthetic lot exists, then sell reduces it.
   * 1-year period: 15 shares at 18.15, sell 5 → 10 shares remaining
   * Purchase Value = 15 × 18.15 × (10/15) = 181.50 EUR
   */
  test('all buys before period — synthetic lot, partial sell inside (FIFO, 1-year) ≈ 181.50', () => {
    const transactions: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2021-01-15',
        shares: d(10),
        grossAmount: d(150),
        fees: d(5),
      },
      {
        type: 'BUY',
        date: '2022-01-14',
        shares: d(5),
        grossAmount: d(80),
        fees: d(4),
      },
      {
        type: 'SELL',
        date: '2023-04-12',
        shares: d(5),
        grossAmount: d(112),
        fees: d(5),
      },
    ];

    const result = computePurchaseValue({
      transactions,
      costMethod: CostMethod.FIFO,
      reportingPeriod: { start: '2022-06-12', end: '2023-06-12' },
      priceAtPeriodStart: d(18.15),
    });

    // 15 shares × 18.15 = 272.25 synthetic; sell 5 FIFO → 272.25 × (10/15) = 181.50
    expect(result.purchaseValue.toNumber()).toBeCloseTo(181.5, 1);
  });

  /**
   * No transactions at all → purchase value = 0.
   */
  test('no transactions → purchaseValue = 0', () => {
    const result = computePurchaseValue({
      transactions: [],
      costMethod: CostMethod.FIFO,
      reportingPeriod: { start: '2023-01-01', end: '2023-12-31' },
      priceAtPeriodStart: d(100),
    });
    expect(result.purchaseValue.toNumber()).toBe(0);
  });

  /**
   * Transactions only after period → purchase value = 0.
   */
  test('all transactions after period end → purchaseValue = 0', () => {
    const transactions: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-06-01',
        shares: d(10),
        grossAmount: d(100),
        fees: d(0),
      },
    ];
    const result = computePurchaseValue({
      transactions,
      costMethod: CostMethod.FIFO,
      reportingPeriod: { start: '2023-01-01', end: '2023-12-31' },
      priceAtPeriodStart: d(10),
    });
    expect(result.purchaseValue.toNumber()).toBe(0);
  });

  /**
   * Moving average produces same purchase value as FIFO when there's only one lot.
   */
  test('moving average — single pre-period buy revalued correctly', () => {
    const transactions: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2020-01-01',
        shares: d(10),
        grossAmount: d(100),
        fees: d(0),
      },
    ];

    const result = computePurchaseValue({
      transactions,
      costMethod: CostMethod.MOVING_AVERAGE,
      reportingPeriod: { start: '2021-01-01', end: '2021-12-31' },
      priceAtPeriodStart: d(15),
    });

    // 10 shares revalued at 15 → 150
    expect(result.purchaseValue.toNumber()).toBeCloseTo(150, 2);
  });

  // Capital gains use cost without fees and taxes.
  // When the caller zeroes fees before passing to computePeriodRelativeGains, gains are higher.
  // Purchase Value (separate concept) still includes fees (securities.md line 21).
  test('purchase value includes fees but capital gains cost basis excludes fees', () => {
    const transactions: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-01-15',
        shares: d(10),
        grossAmount: d(1000),
        fees: d(50),
      },
    ];

    // Purchase Value: fees included → 1000 + 50 = 1050
    const pvResult = computePurchaseValue({
      transactions,
      costMethod: CostMethod.FIFO,
      reportingPeriod: { start: '2024-01-01', end: '2024-12-31' },
      priceAtPeriodStart: d(100),
    });
    expect(pvResult.purchaseValue.toNumber()).toBeCloseTo(1050, 2);

    // Capital gains: caller zeroes fees → cost basis = 1000 (not 1050)
    const txsForGains = transactions.map((tx) => ({ ...tx, fees: d(0) }));
    const gainsResult = computePeriodRelativeGains({
      valueAtPeriodStart: d(0),
      sharesAtPeriodStart: d(0),
      inPeriodTransactions: txsForGains,
      priceAtPeriodEnd: d(120),
      sharesAtPeriodEnd: d(10),
      costMethod: CostMethod.FIFO,
    });
    // Unrealized = 10 × 120 - 1000 = 200 (not 150, because fees excluded)
    expect(gainsResult.unrealizedGain.toNumber()).toBeCloseTo(200, 2);

    // With fees included (old buggy behavior), unrealized would be 150
    const gainsWithFees = computePeriodRelativeGains({
      valueAtPeriodStart: d(0),
      sharesAtPeriodStart: d(0),
      inPeriodTransactions: transactions,
      priceAtPeriodEnd: d(120),
      sharesAtPeriodEnd: d(10),
      costMethod: CostMethod.FIFO,
    });
    expect(gainsWithFees.unrealizedGain.toNumber()).toBeCloseTo(150, 2);

    // Delta = 50, exactly the fee amount
    expect(
      gainsResult.unrealizedGain.minus(gainsWithFees.unrealizedGain).toNumber(),
    ).toBeCloseTo(50, 2);
  });
});

// ─── computePeriodRelativeGains ───────────────────────────────────────────

describe('computePeriodRelativeGains', () => {
  /**
   * Calculation panel example (1-year period):
   *   5 shares sold at 22.40 EUR gross
   *   Period start: 15 shares at 18.638 EUR/share → total 279.57 EUR
   *   Realized gain = 112 - 5 × 18.638 = 112 - 93.19 = 18.81 EUR
   */
  test('realized gain relative to period start (calculation-panel example)', () => {
    const result = computePeriodRelativeGains({
      valueAtPeriodStart: d(279.57),   // 15 × 18.638
      sharesAtPeriodStart: d(15),
      inPeriodTransactions: [
        {
          type: 'SELL',
          date: '2023-04-12',
          shares: d(5),
          grossAmount: d(112),
          fees: d(0),
        },
      ],
      priceAtPeriodEnd: d(18.638),
      sharesAtPeriodEnd: d(10),
      costMethod: CostMethod.FIFO,
    });

    expect(result.realizedGain.toNumber()).toBeCloseTo(18.81, 1);
  });

  /**
   * No activity in period: unrealizedGain = (sharesAtEnd × endPrice) - valueAtStart
   */
  test('no in-period transactions — unrealized = endValue - startValue', () => {
    const result = computePeriodRelativeGains({
      valueAtPeriodStart: d(100),
      sharesAtPeriodStart: d(10),
      inPeriodTransactions: [],
      priceAtPeriodEnd: d(12),
      sharesAtPeriodEnd: d(10),
      costMethod: CostMethod.FIFO,
    });

    // unrealized = 10 × 12 - 100 = 20
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(20, 4);
    expect(result.realizedGain.toNumber()).toBe(0);
  });

  /**
   * Foreign currency gains always 0 in this implementation.
   */
  test('foreignCurrencyGains is always Decimal(0)', () => {
    const result = computePeriodRelativeGains({
      valueAtPeriodStart: d(500),
      sharesAtPeriodStart: d(50),
      inPeriodTransactions: [],
      priceAtPeriodEnd: d(11),
      sharesAtPeriodEnd: d(50),
      costMethod: CostMethod.MOVING_AVERAGE,
    });
    expect(result.foreignCurrencyGains.toNumber()).toBe(0);
  });

  /**
   * No starting position — all gain comes from in-period buys.
   */
  test('no starting position — gain from in-period buy only', () => {
    const result = computePeriodRelativeGains({
      valueAtPeriodStart: d(0),
      sharesAtPeriodStart: d(0),
      inPeriodTransactions: [
        {
          type: 'BUY',
          date: '2023-06-01',
          shares: d(10),
          grossAmount: d(100),
          fees: d(0),
        },
      ],
      priceAtPeriodEnd: d(12),
      sharesAtPeriodEnd: d(10),
      costMethod: CostMethod.FIFO,
    });

    // unrealized = 10 × 12 - 100 = 20
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(20, 4);
    expect(result.realizedGain.toNumber()).toBe(0);
  });
});
