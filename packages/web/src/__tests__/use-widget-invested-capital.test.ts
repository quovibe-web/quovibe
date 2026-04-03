import { describe, test, expect } from 'vitest';
import { sumPurchaseValues } from '../hooks/use-widget-invested-capital';

describe('sumPurchaseValues', () => {
  test('sums purchaseValue strings with Decimal precision', () => {
    const securities = [
      { purchaseValue: '10000.50' },
      { purchaseValue: '5000.25' },
      { purchaseValue: '2500.00' },
    ];
    expect(sumPurchaseValues(securities)).toBe('17500.75');
  });

  test('returns 0 for an empty array', () => {
    expect(sumPurchaseValues([])).toBe('0');
  });

  test('handles a single security', () => {
    expect(sumPurchaseValues([{ purchaseValue: '55041.917253319448061' }])).toBe(
      '55041.917253319448061',
    );
  });

  test('avoids native floating-point drift (0.1 + 0.2 = exactly 0.3)', () => {
    // Native JS: 0.1 + 0.2 === 0.30000000000000004 — Decimal must be used
    const securities = [{ purchaseValue: '0.1' }, { purchaseValue: '0.2' }];
    expect(sumPurchaseValues(securities)).toBe('0.3');
  });

  test('correctly sums many securities', () => {
    const securities = Array.from({ length: 10 }, (_, i) => ({
      purchaseValue: String((i + 1) * 1000),  // native-ok
    }));
    // 1000+2000+...+10000 = 55000
    expect(sumPurchaseValues(securities)).toBe('55000');
  });
});
