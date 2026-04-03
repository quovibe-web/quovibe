import { describe, test, expect } from 'vitest';
import { CALCULATION_ROWS } from '../lib/calculation-rows';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

describe('CALCULATION_ROWS', () => {
  test('all 9 row keys are unique', () => {
    const keys = CALCULATION_ROWS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 9 rows: initialValue, capitalGains, realizedGains, earnings, fees, taxes, cashCurrencyGains, pnt, finalValue
    expect(keys.length).toBe(9);
  });

  test('all signs are valid enum values', () => {
    const validSigns = new Set(['+', '-', '=', '+/-']);
    for (const row of CALCULATION_ROWS) {
      expect(validSigns.has(row.sign)).toBe(true);
    }
  });

  test('sum of rows 2-8 equals finalValue - initialValue on fixture', () => {
    const fixture: CalculationBreakdownResponse = {
      initialValue: '10000',
      capitalGains: { unrealized: '500', realized: '200', foreignCurrencyGains: '50', total: '550', items: [] },
      realizedGains: { total: '200', items: [] },
      earnings: { dividends: '100', interest: '30', total: '130', dividendItems: [] },
      fees: { total: '25', items: [] },
      taxes: { total: '15', items: [] },
      cashCurrencyGains: { total: '-10', items: [] },
      performanceNeutralTransfers: {
        deposits: '1000', removals: '0', deliveryInbound: '0', deliveryOutbound: '0',
        taxes: '0', total: '1000', items: [],
      },
      finalValue: '11830',
      ttwror: '0.05', ttwrorPa: '0.05', irr: '0.04', irrConverged: true, irrError: null,
      delta: '0.05', deltaValue: '500', absoluteChange: '1830',
      absolutePerformance: '1830', absolutePerformancePct: '0.183',
      maxDrawdown: '0.05', currentDrawdown: '0.02', maxDrawdownPeakDate: null, maxDrawdownTroughDate: null, maxDrawdownDuration: 0,
      lastDayAbsoluteChange: '10', lastDayDeltaValue: '10',
      lastDayDelta: '0.001', lastDayAbsolutePerformance: '10',
    };

    // capitalGains.total = unrealized + FX (no realized)
    // realizedGains.total is a separate row
    // earnings.total = dividends + interest (interest is a sub-item, not a separate row)
    const initial = parseFloat(fixture.initialValue);
    const final_ = parseFloat(fixture.finalValue);
    const sum = parseFloat(fixture.capitalGains.total)
      + parseFloat(fixture.realizedGains.total)
      + parseFloat(fixture.earnings.total)
      - parseFloat(fixture.fees.total)
      - parseFloat(fixture.taxes.total)
      + parseFloat(fixture.cashCurrencyGains.total)
      + parseFloat(fixture.performanceNeutralTransfers.total);

    // Verify: 11830 - 10000 = 1830; 550 + 200 + 130 - 25 - 15 + (-10) + 1000 = 1830
    expect(final_ - initial).toBeCloseTo(sum, 2);
  });
});
