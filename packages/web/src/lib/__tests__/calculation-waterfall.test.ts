import { describe, it, expect } from 'vitest';
import {
  buildWaterfallData,
  shouldShowMagnitudeScaleToggle,
  categoryIdForBar,
} from '../calculation-waterfall';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

function makeFixture(overrides: Partial<CalculationBreakdownResponse> = {}): CalculationBreakdownResponse {
  return {
    baseCurrency: 'EUR',
    initialValue: '100000',
    capitalGains: { unrealized: '12000', realized: '4000', foreignCurrencyGains: '200', total: '16200', items: [] },
    realizedGains: { total: '4000', items: [] },
    earnings: { dividends: '1800', interest: '200', total: '2000', dividendItems: [] },
    fees: { total: '1500', items: [] },
    taxes: { total: '650', items: [] },
    cashCurrencyGains: { total: '0', items: [] },
    performanceNeutralTransfers: { deposits: '0', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '-618', items: [] },
    finalValue: '115432',
    ttwror: '0', ttwrorPa: '0', irr: '0', irrConverged: true, irrError: null,
    delta: '0', deltaValue: '0', absoluteChange: '0', absolutePerformance: '0', absolutePerformancePct: '0',
    maxDrawdown: '0', currentDrawdown: '0', maxDrawdownPeakDate: null, maxDrawdownTroughDate: null, maxDrawdownDuration: 0,
    volatility: null, semivariance: null, sharpeRatio: null,
    lastDayAbsoluteChange: '0', lastDayDeltaValue: '0', lastDayDelta: '0', lastDayAbsolutePerformance: '0',
    openPositionPnL: { value: '0', percentage: '0', cost: '0', marketValue: '0', fifo: { value: '0', percentage: '0', cost: '0' } },
    ...overrides,
  };
}

describe('buildWaterfallData', () => {
  it('returns 5 bars in MVB → Drivers → Frictions → Flows → MVE order', () => {
    const bars = buildWaterfallData(makeFixture());
    expect(bars.map((b) => b.name)).toEqual(['MVB', 'Drivers', 'Frictions', 'Flows', 'MVE']);
  });

  it('MVB and MVE bars start at base 0 with full value', () => {
    const bars = buildWaterfallData(makeFixture());
    expect(bars[0].base).toBe(0);
    expect(bars[0].value).toBe(100000);
    expect(bars[4].base).toBe(0);
    expect(bars[4].value).toBe(115432);
  });

  it('Drivers bar floats from MVB and sums capitalGains + earnings + cashCurrencyGains', () => {
    const bars = buildWaterfallData(makeFixture());
    expect(bars[1].base).toBe(100000);
    expect(bars[1].value).toBeCloseTo(18200);
  });

  it('Frictions bar renders as a negative value above the post-drivers running total', () => {
    const bars = buildWaterfallData(makeFixture());
    expect(bars[2].base).toBe(118200 - 2150);
    expect(bars[2].value).toBeCloseTo(-2150);
  });

  it('Flows bar floats from the post-frictions running total by the PNT total (negative here)', () => {
    const bars = buildWaterfallData(makeFixture());
    expect(bars[3].base).toBe(116050 + (-618));
    expect(bars[3].value).toBeCloseTo(-618);
  });

  it('handles an all-positive flows period (net deposit) correctly', () => {
    const bars = buildWaterfallData(makeFixture({
      performanceNeutralTransfers: { deposits: '5000', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '5000', items: [] },
      finalValue: '121050',
    }));
    expect(bars[3].value).toBeCloseTo(5000);
    expect(bars[3].base).toBe(116050);
  });

  it('ALL-period MVB=0: initial bar is zero, all 5 bars produced, non-zero middle bars intact', () => {
    const bars = buildWaterfallData(makeFixture({
      initialValue: '0',
      capitalGains: { unrealized: '10591.93', realized: '0', foreignCurrencyGains: '0', total: '10591.93', items: [] },
      earnings: { dividends: '0', interest: '0', total: '0', dividendItems: [] },
      fees: { total: '1117.88', items: [] },
      taxes: { total: '0', items: [] },
      cashCurrencyGains: { total: '0', items: [] },
      performanceNeutralTransfers: { deposits: '144223.09', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '144223.09', items: [] },
      finalValue: '153697.14',
    }));
    expect(bars).toHaveLength(5);
    // MVB anchor: base=0, value=0, magnitude=0
    expect(bars[0].base).toBe(0);
    expect(bars[0].value).toBe(0);
    expect(bars[0].magnitude).toBe(0);
    expect(bars[0].isAnchor).toBe(true);
    // Drivers float from MVB=0
    expect(bars[1].base).toBe(0);
    expect(bars[1].value).toBeCloseTo(10591.93);
    expect(bars[1].magnitude).toBeCloseTo(10591.93);
    // Flows non-zero and positive
    expect(bars[3].magnitude).toBeCloseTo(144223.09);
    expect(bars[3].value).toBeGreaterThan(0);
    // MVE anchor: base=0, value=final
    expect(bars[4].base).toBe(0);
    expect(bars[4].value).toBeCloseTo(153697.14);
  });

  it('zero-activity period: all middle bars are zero, MVB === MVE', () => {
    const bars = buildWaterfallData(makeFixture({
      initialValue: '100000', finalValue: '100000',
      capitalGains: { unrealized: '0', realized: '0', foreignCurrencyGains: '0', total: '0', items: [] },
      earnings: { dividends: '0', interest: '0', total: '0', dividendItems: [] },
      fees: { total: '0', items: [] },
      taxes: { total: '0', items: [] },
      cashCurrencyGains: { total: '0', items: [] },
      performanceNeutralTransfers: { deposits: '0', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '0', items: [] },
    }));
    expect(bars[1].value).toBe(0);
    expect(bars[2].value).toBe(0);
    expect(bars[3].value).toBe(0);
    expect(bars[0].value).toBe(100000);
    expect(bars[4].value).toBe(100000);
  });
});

describe('shouldShowMagnitudeScaleToggle', () => {
  it('false when middle-bar magnitudes are within 30x of each other', () => {
    // Default fixture: Drivers=18200, Frictions=2150, Flows=618 → ratio ≈ 29.4 (< 30)
    const bars = buildWaterfallData(makeFixture());
    expect(shouldShowMagnitudeScaleToggle(bars)).toBe(false);
  });

  it('true when one middle bar is more than 30x the smallest non-zero middle bar', () => {
    // capitalGains.total=1000000 → Drivers≈1002000, ratio vs Flows(618) ≈ 1621
    const bars = buildWaterfallData(makeFixture({
      capitalGains: { unrealized: '1000000', realized: '0', foreignCurrencyGains: '0', total: '1000000', items: [] },
      finalValue: '1100000',
    }));
    expect(shouldShowMagnitudeScaleToggle(bars)).toBe(true);
  });

  it('ignores zero-magnitude bars when computing the ratio', () => {
    // Flows=0 is excluded; middle non-zero = Drivers(18200), Frictions(2150) → ratio ≈ 8.5 (< 30)
    const bars = buildWaterfallData(makeFixture({
      performanceNeutralTransfers: { deposits: '0', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '0', items: [] },
      finalValue: '116050',
    }));
    expect(shouldShowMagnitudeScaleToggle(bars)).toBe(false);
  });
});

describe('categoryIdForBar', () => {
  it('maps anchor bars to "anchors"', () => {
    expect(categoryIdForBar('MVB')).toBe('anchors');
    expect(categoryIdForBar('MVE')).toBe('anchors');
  });

  it('maps middle bars to their category ids', () => {
    expect(categoryIdForBar('Drivers')).toBe('drivers');
    expect(categoryIdForBar('Frictions')).toBe('frictions');
    expect(categoryIdForBar('Flows')).toBe('flows');
  });

  it('throws on unknown name (defensive — no silent fallback)', () => {
    expect(() => categoryIdForBar('Garbage')).toThrow();
  });
});
