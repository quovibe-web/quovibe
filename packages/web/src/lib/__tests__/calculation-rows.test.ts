import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { CALCULATION_CATEGORIES } from '../calculation-rows';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

function makeFixture(overrides: Partial<CalculationBreakdownResponse> = {}): CalculationBreakdownResponse {
  return {
    baseCurrency: 'EUR',
    initialValue: '100000',
    capitalGains: { unrealized: '12000', realized: '4000', foreignCurrencyGains: '200', total: '16200', items: [{ securityId: 's1', name: 'AAPL', unrealizedGain: '8000', foreignCurrencyGains: '100', initialValue: '20000', finalValue: '28000' }] },
    realizedGains: { total: '4000', items: [{ securityId: 's1', name: 'AAPL', realizedGain: '4000', proceeds: '12000', costAtPeriodStart: '8000' }] },
    earnings: { dividends: '1800', interest: '200', total: '2000', dividendItems: [{ securityId: 's1', name: 'AAPL', dividends: '1800' }] },
    fees: { total: '1500', items: [{ securityId: 's1', name: 'AAPL', fees: '1500' }] },
    taxes: { total: '650', items: [{ securityId: 's1', name: 'AAPL', taxes: '650' }] },
    cashCurrencyGains: { total: '0', items: [] },
    performanceNeutralTransfers: { deposits: '0', removals: '0', deliveryInbound: '0', deliveryOutbound: '0', taxes: '0', total: '-618', items: [{ type: 'REMOVAL', accountId: 'a1', name: 'Bank', amount: '-618', date: '2026-03-15' }] },
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

describe('CALCULATION_CATEGORIES', () => {
  it('exports exactly four categories in fixed order', () => {
    expect(CALCULATION_CATEGORIES.map((c) => c.id)).toEqual(['drivers', 'frictions', 'flows', 'anchors']);
  });

  it('drivers.extractTotal sums capitalGains + earnings + cashCurrencyGains', () => {
    const drivers = CALCULATION_CATEGORIES[0];
    const total = drivers.extractTotal(makeFixture());
    expect(parseFloat(total)).toBeCloseTo(18200);
  });

  it('frictions.extractTotal sums fees + taxes', () => {
    const frictions = CALCULATION_CATEGORIES[1];
    expect(parseFloat(frictions.extractTotal(makeFixture()))).toBeCloseTo(2150);
  });

  it('flows.extractTotal returns performanceNeutralTransfers.total', () => {
    const flows = CALCULATION_CATEGORIES[2];
    expect(parseFloat(flows.extractTotal(makeFixture()))).toBeCloseTo(-618);
  });

  it('drivers.extractSubRows returns the 6 sub-row totals', () => {
    const drivers = CALCULATION_CATEGORIES[0];
    const rows = drivers.extractSubRows(makeFixture());
    expect(rows.map((r) => r.labelKey)).toEqual([
      'calculation.unrealizedGains',
      'calculation.realizedGains',
      'calculation.dividends',
      'calculation.interest',
      'calculation.foreignCurrencyGains',
      'calculation.currencyGainsOnCash',
    ]);
  });

  it('frictions.extractSubRows returns fees + taxes', () => {
    const frictions = CALCULATION_CATEGORIES[1];
    const rows = frictions.extractSubRows(makeFixture());
    expect(rows.map((r) => r.labelKey)).toEqual(['calculation.fees', 'calculation.taxes']);
    expect(rows[0].total).toBe('1500');
    expect(rows[1].total).toBe('650');
  });

  it('identity holds: MVB + drivers − frictions + flows = MVE within tolerance', () => {
    const data = makeFixture();
    const drivers = parseFloat(CALCULATION_CATEGORIES[0].extractTotal(data));
    const frictions = parseFloat(CALCULATION_CATEGORIES[1].extractTotal(data));
    const flows = parseFloat(CALCULATION_CATEGORIES[2].extractTotal(data));
    const computed = new Decimal(data.initialValue).plus(drivers).minus(frictions).plus(flows);
    expect(computed.minus(data.finalValue).abs().toNumber()).toBeLessThan(0.01);
  });

  it('drivers.extractDrillDownTables returns the 5 sub-tables when items present', () => {
    const drivers = CALCULATION_CATEGORIES[0];
    const tables = drivers.extractDrillDownTables(makeFixture());
    expect(tables.length).toBe(5);
    expect(tables.map((t) => t.titleKey)).toContain('calculation.unrealizedGains');
    expect(tables.map((t) => t.titleKey)).toContain('calculation.realizedGains');
    expect(tables.map((t) => t.titleKey)).toContain('calculation.dividends');
    expect(tables.map((t) => t.titleKey)).toContain('calculation.interest');
  });

  it('flows.extractDrillDownTables returns one transaction-list table', () => {
    const flows = CALCULATION_CATEGORIES[2];
    const tables = flows.extractDrillDownTables(makeFixture());
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].rows[0].name).toBe('Bank');
    expect(tables[0].rows[0].date).toBe('2026-03-15');
  });
});
