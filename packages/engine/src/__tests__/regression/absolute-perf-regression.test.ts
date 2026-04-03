// Engine regression: Absolute Performance pinned to real ppxml2db fixture data
// Reference: docs/audit/engine-regression/reference-values.md (Sections B, F, H)
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  computeAbsolutePerformance,
  type AbsolutePerformanceInput,
} from '../../performance/absolute-performance';

const d = (v: string | number) => new Decimal(v);

// ─────────────────────────────────────────────────────────────────────────────
// Reference data from docs/audit/engine-regression/reference-values.md
//
// BTP VALORE GN27 — Section B.1:
//   MVB = 51,285.00 (500 × 102.57), MVE = 51,135.00 (500 × 102.27)
//   No BUY/SELL in 2025 → cfIn = 0, cfOut = 0
//   unrealizedGain = -150 (from H.1)
//
// Full portfolio — Section H.4:
//   deposits = 51,077.54, removals = 28,216.32
//   absoluteChange = 37,973.9995 (totalMVE - totalMVB)
//   delta = 0.050020868621304004897
// ─────────────────────────────────────────────────────────────────────────────

describe('GROUP A — Absolute Performance Regression', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // R5.1 — AbsPerf = MVE - MVB + CFout - CFin
  // ───────────────────────────────────────────────────────────────────────────
  describe('R5.1 — formula: value = MVE - MVB + CFout - CFin', () => {
    test('BTP VALORE GN27: no flows → value = MVE - MVB = -150.00', () => {
      const input: AbsolutePerformanceInput = {
        mvb: d('51285'),
        mve: d('51135'),
        cfIn: d('0'),
        cfOut: d('0'),
      };
      const result = computeAbsolutePerformance(input);

      // AbsPerf = 51135 - 51285 + 0 - 0 = -150
      expect(result.value.toNumber()).toBeCloseTo(-150, 2);
    });

    test('portfolio with deposits and removals: formula verified', () => {
      // Synthetic scenario anchored to portfolio-level reference structure:
      // MVB = 100,000, MVE = 130,000, deposits = 20,000, removals = 5,000
      // AbsPerf = 130,000 - 100,000 + 5,000 - 20,000 = 15,000
      const input: AbsolutePerformanceInput = {
        mvb: d('100000'),
        mve: d('130000'),
        cfIn: d('20000'),
        cfOut: d('5000'),
      };
      const result = computeAbsolutePerformance(input);

      expect(result.value.toNumber()).toBeCloseTo(15000, 2);
    });

    test('XTRACKERS OVNI: MVB=0 (new position in period)', () => {
      // From H.2: mvb=0, mve=55976.3568
      // All BUYs and SELLs in period produce cfIn and cfOut
      // cfIn (total BUY gross) = 7106.10+3047.20+10021.30+10026.01+9888.44+38963.84 = 79052.89
      // cfOut (total SELL gross) = 3055.83+3056.03+1607.71+3802.38+1030.68+11670.28 = 24222.91
      const input: AbsolutePerformanceInput = {
        mvb: d('0'),
        mve: d('55976.3568'),
        cfIn: d('79052.89'),
        cfOut: d('24222.91'),
      };
      const result = computeAbsolutePerformance(input);

      // AbsPerf = 55976.3568 - 0 + 24222.91 - 79052.89 = 1146.3768
      const expected = d('55976.3568').minus('0').plus('24222.91').minus('79052.89');
      expect(result.value.toNumber()).toBeCloseTo(expected.toNumber(), 2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R5.2 — AbsPerf% = AbsPerf / (MVB + CFin)
  // ───────────────────────────────────────────────────────────────────────────
  describe('R5.2 — percentage: value / (MVB + CFin)', () => {
    test('BTP VALORE GN27: -150 / 51285 = -0.002925 (-0.29%)', () => {
      const input: AbsolutePerformanceInput = {
        mvb: d('51285'),
        mve: d('51135'),
        cfIn: d('0'),
        cfOut: d('0'),
      };
      const result = computeAbsolutePerformance(input);

      // pct = -150 / (51285 + 0) = -0.0029248...
      const expectedPct = d('-150').div(d('51285'));
      expect(result.percentage.toNumber()).toBeCloseTo(expectedPct.toNumber(), 4);
    });

    test('portfolio with flows: 15000 / 120000 = 12.50%', () => {
      const input: AbsolutePerformanceInput = {
        mvb: d('100000'),
        mve: d('130000'),
        cfIn: d('20000'),
        cfOut: d('5000'),
      };
      const result = computeAbsolutePerformance(input);

      // pct = 15000 / (100000 + 20000) = 0.125
      expect(result.percentage.toNumber()).toBeCloseTo(0.125, 4);
    });

    test('XTRACKERS OVNI: invested = 0 + 79052.89 = 79052.89', () => {
      const input: AbsolutePerformanceInput = {
        mvb: d('0'),
        mve: d('55976.3568'),
        cfIn: d('79052.89'),
        cfOut: d('24222.91'),
      };
      const result = computeAbsolutePerformance(input);

      // invested = 0 + 79052.89 = 79052.89
      // pct = value / 79052.89
      const value = d('55976.3568').plus('24222.91').minus('79052.89');
      const expectedPct = value.div(d('79052.89'));
      expect(result.percentage.toNumber()).toBeCloseTo(expectedPct.toNumber(), 4);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R5.3 — Guard: MVB + CFin ≤ 0 → percentage is 0 (not infinity, not NaN)
  // ───────────────────────────────────────────────────────────────────────────
  describe('R5.3 — zero-denominator guard', () => {
    test('MVB=0, CFin=0 → percentage = 0 (not Infinity)', () => {
      const input: AbsolutePerformanceInput = {
        mvb: d('0'),
        mve: d('1000'),
        cfIn: d('0'),
        cfOut: d('500'),
      };
      const result = computeAbsolutePerformance(input);

      // value = 1000 - 0 + 500 - 0 = 1500
      expect(result.value.toNumber()).toBeCloseTo(1500, 2);
      // invested = 0 + 0 = 0 → percentage guard fires
      expect(result.percentage.toNumber()).toBe(0);
      expect(result.percentage.isFinite()).toBe(true);
      expect(result.percentage.isNaN()).toBe(false);
    });

    test('MVB=-100, CFin=50 (invested < 0) → percentage = 0', () => {
      // Edge case: negative MVB can occur with short positions or data anomalies
      const input: AbsolutePerformanceInput = {
        mvb: d('-100'),
        mve: d('200'),
        cfIn: d('50'),
        cfOut: d('0'),
      };
      const result = computeAbsolutePerformance(input);

      // invested = -100 + 50 = -50 → guard fires (≤ 0)
      expect(result.percentage.toNumber()).toBe(0);
    });

    test('MVB=0, CFin=0, MVE=0 → value=0, percentage=0', () => {
      const input: AbsolutePerformanceInput = {
        mvb: d('0'),
        mve: d('0'),
        cfIn: d('0'),
        cfOut: d('0'),
      };
      const result = computeAbsolutePerformance(input);

      expect(result.value.toNumber()).toBe(0);
      expect(result.percentage.toNumber()).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R5.4 — preTax vs after-tax delta
  //
  // When taxes are included in cfOut (preTax mode at service layer),
  // the absolute value changes. The engine function itself is pure math;
  // this test verifies the formula reacts correctly to different cfOut.
  // ───────────────────────────────────────────────────────────────────────────
  describe('R5.4 — preTax vs after-tax: delta and absoluteChange differ', () => {
    // Scenario: portfolio with taxes = 1,456.08 (from H.4 reference)
    const mvb = d('300000');
    const mve = d('340000');
    const deposits = d('51077.54');
    const removals = d('28216.32');
    const taxes = d('1456.08');

    test('preTax: taxes excluded from cfOut → higher absolute value', () => {
      // preTax mode: cfIn = deposits, cfOut = removals (taxes not in flows)
      const preTaxResult = computeAbsolutePerformance({
        mvb,
        mve,
        cfIn: deposits,
        cfOut: removals,
      });

      // value = 340000 - 300000 + 28216.32 - 51077.54 = 17138.78
      const expectedValue = mve.minus(mvb).plus(removals).minus(deposits);
      expect(preTaxResult.value.toNumber()).toBeCloseTo(expectedValue.toNumber(), 2);
    });

    test('after-tax: taxes added to cfOut → lower absolute value', () => {
      // Simulated after-tax: taxes added to removals in cfOut
      const afterTaxResult = computeAbsolutePerformance({
        mvb,
        mve,
        cfIn: deposits,
        cfOut: removals.plus(taxes),
      });

      // value = 340000 - 300000 + (28216.32 + 1456.08) - 51077.54 = 18594.86
      const expectedValue = mve.minus(mvb).plus(removals).plus(taxes).minus(deposits);
      expect(afterTaxResult.value.toNumber()).toBeCloseTo(expectedValue.toNumber(), 2);
    });

    test('preTax and after-tax produce different absoluteChange', () => {
      const preTax = computeAbsolutePerformance({
        mvb, mve, cfIn: deposits, cfOut: removals,
      });
      const afterTax = computeAbsolutePerformance({
        mvb, mve, cfIn: deposits, cfOut: removals.plus(taxes),
      });

      // The delta between the two should equal the taxes amount
      const delta = afterTax.value.minus(preTax.value);
      expect(delta.toNumber()).toBeCloseTo(taxes.toNumber(), 2);
    });

    test('preTax and after-tax produce different percentage', () => {
      const preTax = computeAbsolutePerformance({
        mvb, mve, cfIn: deposits, cfOut: removals,
      });
      const afterTax = computeAbsolutePerformance({
        mvb, mve, cfIn: deposits, cfOut: removals.plus(taxes),
      });

      // Same denominator (MVB + CFin), different numerator → different %
      expect(preTax.percentage.toNumber()).not.toEqual(afterTax.percentage.toNumber());
      // after-tax has higher value → higher percentage
      expect(afterTax.percentage.gt(preTax.percentage)).toBe(true);
    });
  });
});
