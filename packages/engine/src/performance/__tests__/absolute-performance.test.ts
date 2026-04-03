// Reference: Absolute performance — capital gain (MVE - MVB - net cashflows)
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeAbsolutePerformance } from '../absolute-performance';

describe('computeAbsolutePerformance', () => {
  it('only buys, no sales/dividends: gain is market appreciation', () => {
    // MVB=0, MVE=1200, cfIn=1000 (buy), cfOut=0 → AbsPerf = 200
    const result = computeAbsolutePerformance({
      mvb: new Decimal(0),
      mve: new Decimal(1200),
      cfIn: new Decimal(1000),
      cfOut: new Decimal(0),
    });
    expect(result.value.toNumber()).toBe(200);
    expect(result.percentage.toNumber()).toBe(0.2);
  });

  it('buy + partial sell at profit', () => {
    // MVB=1000, MVE=600, cfOut=550 (sale proceeds), cfIn=0 → AbsPerf = 150
    const result = computeAbsolutePerformance({
      mvb: new Decimal(1000),
      mve: new Decimal(600),
      cfIn: new Decimal(0),
      cfOut: new Decimal(550),
    });
    expect(result.value.toNumber()).toBe(150);
    expect(result.percentage.toFixed(4)).toBe('0.1500');
  });

  it('dividends and fees already reflected in MVE', () => {
    // MVB=5000, MVE=5100 (includes +200 dividend −50 fees = +150 net cash),
    // cfIn=0, cfOut=0 → AbsPerf = 100
    const result = computeAbsolutePerformance({
      mvb: new Decimal(5000),
      mve: new Decimal(5100),
      cfIn: new Decimal(0),
      cfOut: new Decimal(0),
    });
    expect(result.value.toNumber()).toBe(100);
    expect(result.percentage.toFixed(4)).toBe('0.0200');
  });

  it('zero denominator returns 0 percentage', () => {
    // MVB=0, cfIn=0: invested capital is 0 → percentage must be 0 (no division by zero)
    const result = computeAbsolutePerformance({
      mvb: new Decimal(0),
      mve: new Decimal(0),
      cfIn: new Decimal(0),
      cfOut: new Decimal(0),
    });
    expect(result.value.toNumber()).toBe(0);
    expect(result.percentage.toNumber()).toBe(0);
  });
});
