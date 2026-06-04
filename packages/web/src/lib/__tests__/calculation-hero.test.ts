import { describe, it, expect } from 'vitest';
import { extractHeroTiles } from '../calculation-hero';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

function makeFixture(overrides: Partial<CalculationBreakdownResponse> = {}): CalculationBreakdownResponse {
  return {
    baseCurrency: 'EUR',
    unresolvedCount: 0,
    unresolvedSecurityIds: [],
    initialValue: '100000',
    capitalGains: { unrealized: '12000', realized: '4000', foreignCurrencyGains: '200', total: '16200', items: [] },
    realizedGains: { total: '4000', items: [] },
    earnings: { dividends: '1800', interest: '200', total: '2000', dividendItems: [] },
    fees: { total: '1500', items: [] },
    taxes: { total: '650', items: [] },
    cashCurrencyGains: { total: '0', items: [] },
    performanceNeutralTransfers: { deposits: '0', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '-618', items: [] },
    finalValue: '115432',
    ttwror: '0.1234',
    ttwrorPa: '0.0821',
    irr: '0.0987',
    irrConverged: true,
    irrError: null,
    delta: '0.112',
    deltaValue: '12345.67',
    absoluteChange: '12345.67',
    absolutePerformance: '0.112',
    absolutePerformancePct: '0.112',
    maxDrawdown: '-0.0843',
    currentDrawdown: '-0.0210',
    maxDrawdownPeakDate: '2026-03-15',
    maxDrawdownTroughDate: '2026-04-22',
    maxDrawdownDuration: 38,
    volatility: '0.142',
    semivariance: '0.098',
    sharpeRatio: '0.72',
    lastDayAbsoluteChange: '124.50',
    lastDayDeltaValue: '124.50',
    lastDayDelta: '0.0011',
    lastDayAbsolutePerformance: '0.0012',
    openPositionPnL: {
      value: '8432',
      percentage: '0.0842',
      cost: '100000',
      marketValue: '108432',
      fifo: { value: '7901', percentage: '0.0791', cost: '99800' },
    },
    realizedCapitalBase: '0',
    realizedFxBase: '0',
    unrealizedCapitalBase: '0',
    unrealizedFxBase: '0',
    dividendFxBase: '0',
    ...overrides,
  };
}

describe('extractHeroTiles', () => {
  it('returns six tiles in fixed order', () => {
    const tiles = extractHeroTiles(makeFixture());
    expect(tiles).toHaveLength(6);
    expect(tiles.map((t) => t.id)).toEqual([
      'ttwror',
      'irr',
      'deltaPercent',
      'deltaAbsolute',
      'maxDrawdown',
      'sharpe',
    ]);
  });

  it('TTWROR tile carries the fractional value + p.a. sub-line', () => {
    const [ttwror] = extractHeroTiles(makeFixture());
    expect(ttwror.value).toBeCloseTo(0.1234);
    expect(ttwror.format).toBe('signedPercent');
    expect(ttwror.subValue).toBeCloseTo(0.0821);
    expect(ttwror.subFormat).toBe('signedPercent');
  });

  it('IRR tile shows null when not converged', () => {
    const [, irr] = extractHeroTiles(makeFixture({ irrConverged: false, irr: null, irrError: 'no convergence' }));
    expect(irr.value).toBeNull();
    expect(irr.subText).toBe('no convergence');
  });

  it('Sharpe tile shows null when sharpeRatio is null', () => {
    const tiles = extractHeroTiles(makeFixture({ sharpeRatio: null }));
    const sharpe = tiles.find((t) => t.id === 'sharpe')!;
    expect(sharpe.value).toBeNull();
  });

  it('MaxDD tile carries peak / trough / duration in subValues', () => {
    const tiles = extractHeroTiles(makeFixture());
    const maxDd = tiles.find((t) => t.id === 'maxDrawdown')!;
    expect(maxDd.value).toBeCloseTo(-0.0843);
    expect(maxDd.peakDate).toBe('2026-03-15');
    expect(maxDd.troughDate).toBe('2026-04-22');
    expect(maxDd.durationDays).toBe(38);
  });

  it('Δ% and Δ€ tiles carry separate numeric channels', () => {
    const [, , deltaPct, deltaAbs] = extractHeroTiles(makeFixture());
    expect(deltaPct.value).toBeCloseTo(0.112);
    expect(deltaPct.format).toBe('signedPercent');
    expect(deltaAbs.value).toBeCloseTo(12345.67);
    expect(deltaAbs.format).toBe('signedCurrency');
  });

  it('handles a zero-activity period without throwing', () => {
    const tiles = extractHeroTiles(makeFixture({
      ttwror: '0', ttwrorPa: '0', irr: '0', irrConverged: true,
      delta: '0', deltaValue: '0', maxDrawdown: '0',
      sharpeRatio: null, volatility: null,
    }));
    expect(tiles).toHaveLength(6);
    expect(tiles[0].value).toBe(0);
    expect(tiles[5].value).toBeNull();
  });
});
