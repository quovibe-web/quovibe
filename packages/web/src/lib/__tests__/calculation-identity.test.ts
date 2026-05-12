import { describe, it, expect } from 'vitest';
import { validateIdentity, buildIdentityOperands } from '../calculation-identity';
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

describe('validateIdentity', () => {
  it('returns ok=true with near-zero drift for a balanced response', () => {
    const r = validateIdentity(makeFixture());
    expect(r.ok).toBe(true);
    expect(Math.abs(r.drift)).toBeLessThan(0.01);
  });

  it('flags ok=false when the response is internally inconsistent', () => {
    const r = validateIdentity(makeFixture({ finalValue: '200000' }));
    expect(r.ok).toBe(false);
    expect(r.drift).toBeGreaterThan(1);
  });

  it('tolerance is < 0.01 currency units, not relative', () => {
    const r = validateIdentity(makeFixture({ finalValue: '115432.005' }));
    expect(r.ok).toBe(true);
  });
});

describe('buildIdentityOperands', () => {
  const t = (key: string) => {
    const map: Record<string, string> = {
      'calculation.equation.labelMvb': 'MVB',
      'calculation.equation.labelDrivers': 'Drivers',
      'calculation.equation.labelFrictions': 'Frictions',
      'calculation.equation.labelFlows': 'Flows',
      'calculation.equation.labelMve': 'MVE',
    };
    return map[key] ?? key;
  };

  it('emits 5 operands in MVB, Drivers, Frictions, Flows, MVE order', () => {
    const { operands } = buildIdentityOperands(makeFixture(), 'en-US', t);
    expect(operands.map((o) => o.label)).toEqual(['MVB', 'Drivers', 'Frictions', 'Flows', 'MVE']);
  });

  it('MVB and MVE carry sign=0 (anchors, no colorize)', () => {
    const { operands } = buildIdentityOperands(makeFixture(), 'en-US', t);
    expect(operands[0].sign).toBe(0);
    expect(operands[4].sign).toBe(0);
  });

  it('Drivers carries sign=1 when positive', () => {
    const { operands } = buildIdentityOperands(makeFixture(), 'en-US', t);
    expect(operands[1].sign).toBe(1);
    expect(operands[1].formattedValue.startsWith('+')).toBe(true);
  });

  it('Frictions always carries sign=-1 when non-zero', () => {
    const { operands } = buildIdentityOperands(makeFixture(), 'en-US', t);
    expect(operands[2].sign).toBe(-1);
    expect(operands[2].formattedValue.startsWith('−')).toBe(true);
  });

  it('Flows carries sign=-1 when total is negative', () => {
    const { operands } = buildIdentityOperands(makeFixture(), 'en-US', t);
    expect(operands[3].sign).toBe(-1);
    expect(operands[3].formattedValue.startsWith('−')).toBe(true);
  });

  it('Flows carries sign=1 when total is positive (net deposit)', () => {
    const { operands } = buildIdentityOperands(
      makeFixture({
        performanceNeutralTransfers: { deposits: '5000', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '5000', items: [] },
        finalValue: '121050',
      }),
      'en-US',
      t,
    );
    expect(operands[3].sign).toBe(1);
    expect(operands[3].formattedValue.startsWith('+')).toBe(true);
  });

  it('Flows carries sign=0 when zero', () => {
    const { operands } = buildIdentityOperands(
      makeFixture({
        performanceNeutralTransfers: { deposits: '0', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '0', items: [] },
        finalValue: '116050',
      }),
      'en-US',
      t,
    );
    expect(operands[3].sign).toBe(0);
  });

  it('attaches identity check to the output', () => {
    const { identity } = buildIdentityOperands(makeFixture(), 'en-US', t);
    expect(identity.ok).toBe(true);
  });
});
