// Reference: Internal Rate of Return (IRR) — Newton-Raphson method
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeIRR } from '../irr';

/**
 * IRR — Internal Rate of Return (Newton-Raphson)
 *
 * Sign convention for cashflows (security level, per resolver.ts):
 *   - Buy / Delivery In  → positive (inflow to security = investor pays)
 *   - Sell / Dividend    → negative (outflow from security = investor receives)
 *
 * IRR formula (Eq 1):
 *   MVB × (1+IRR)^(RD/365) + Σ CF_t × (1+IRR)^(RD_t/365) = MVE
 */

function d(n: number): Decimal {
  return new Decimal(n);
}

describe('computeIRR — reference examples', () => {
  /**
   * Example 5 (irr.md): share-2, single buy transaction
   *
   * Period: 2020-06-12 → 2023-06-12 (1095 days)
   * MVB = 0
   * CF1 (buy, 2022-09-30): 8 shares × 8 EUR/share + 2 EUR fees = 66 EUR
   *   Remaining days to 2023-06-12 = 255
   * MVE = 111.76 EUR (8 shares × 13.97 EUR/share)
   * Expected IRR = 112.53%
   *
   * Verification: 66 × (1 + 1.1253)^(255/365) = 66 × 2.1253^0.6986 ≈ 111.76 ✓
   */
  it('Example 5: share-2, one buy → IRR ≈ 112.53%', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(111.76),
      cashflows: [{ date: '2022-09-30', amount: d(66) }],
      periodStart: '2020-06-12',
      periodEnd: '2023-06-12',
    });

    expect(result).not.toBeNull();
    const irr = result!.toNumber();
    expect(irr).toBeCloseTo(1.1253, 2); // ±0.005 tolerance
  });

  /**
   * Example 6 (irr.md): share-1, multiple transactions
   *
   * Period: 2020-06-12 → 2023-06-12 (1095 days)
   * MVB = 0
   * CF1 (buy, 2021-01-15): 10 × 15 EUR + 3 EUR fees = 153 EUR  [RD=878 days]
   * CF2 (buy, 2022-01-14): 5 × 16 EUR + 3 EUR fees = 83 EUR    [RD=514 days]
   * CF3 (dividend, 2022-12-15): −30 EUR (outflow from security) [RD=179 days]
   * CF4 (sell, 2023-04-12): −107 EUR (outflow from security)    [RD=61 days]
   * MVE = 190.06 EUR (10 shares × 19.006 EUR/share)
   * Expected IRR = 18%
   *
   * Verification at IRR=18%:
   *   153×1.18^(878/365) + 83×1.18^(514/365) - 30×1.18^(179/365) - 107×1.18^(61/365)
   *   ≈ 227.97 + 104.75 - 32.52 - 109.99 ≈ 190.21 ≈ 190.06 ✓
   */
  it('Example 6: share-1, 2 buys + dividend + sell → IRR ≈ 18%', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(190.06),
      cashflows: [
        { date: '2021-01-15', amount: d(153) },   // buy: positive
        { date: '2022-01-14', amount: d(83) },    // buy: positive
        { date: '2022-12-15', amount: d(-30) },   // dividend: negative (outflow)
        { date: '2023-04-12', amount: d(-107) },  // sell: negative (outflow)
      ],
      periodStart: '2020-06-12',
      periodEnd: '2023-06-12',
    });

    expect(result).not.toBeNull();
    const irr = result!.toNumber();
    expect(irr).toBeCloseTo(0.18, 2); // ±0.005 tolerance
  });

  /**
   * Trivial case: no cashflows, MVB == MVE → IRR = 0
   */
  it('no cashflows, MVB = MVE → IRR = 0', () => {
    const result = computeIRR({
      mvb: d(1000),
      mve: d(1000),
      cashflows: [],
      periodStart: '2023-01-01',
      periodEnd: '2023-12-31',
    });

    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0, 5);
  });

  /**
   * Zero-day period → returns 0 without computing
   */
  it('zero-day period → returns 0', () => {
    const result = computeIRR({
      mvb: d(500),
      mve: d(600),
      cashflows: [],
      periodStart: '2023-06-01',
      periodEnd: '2023-06-01',
    });

    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBe(0);
  });

  /**
   * Positive growth with no cashflows: MVB=1000, MVE=1100, period=1 year → IRR=10%
   */
  it('no cashflows, 10% annual growth → IRR = 10%', () => {
    const result = computeIRR({
      mvb: d(1000),
      mve: d(1100),
      cashflows: [],
      periodStart: '2023-01-01',
      periodEnd: '2024-01-01',
    });

    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0.1, 4);
  });

  /**
   * Portfolio level example (irr.md Example 1): one deposit, IRR=0
   * MVB=0, CF=155 EUR, MVE=155 EUR → no growth → IRR=0
   */
  it('portfolio level: deposit only → IRR = 0', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(155),
      cashflows: [{ date: '2021-01-15', amount: d(155) }],
      periodStart: '2020-06-12',
      periodEnd: '2023-06-12',
    });

    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0, 5);
  });
});
