import { describe, it, expect } from 'vitest';
import { buildCurrencyOptions, swapPair } from '../currency-converter.utils';

describe('currency-converter.utils', () => {
  describe('buildCurrencyOptions', () => {
    it('returns base list sorted alphabetically', () => {
      const out = buildCurrencyOptions(
        [{ code: 'USD' }, { code: 'EUR' }, { code: 'JPY' }],
        [],
      );
      expect(out).toEqual(['EUR', 'JPY', 'USD']);
    });

    it('merges in extra codes from server pairs and dedupes', () => {
      const out = buildCurrencyOptions(
        [{ code: 'USD' }, { code: 'EUR' }],
        ['USD', 'CZK', 'EUR'],
      );
      expect(out).toEqual(['CZK', 'EUR', 'USD']);
    });

    it('returns only extras when base list is empty', () => {
      const out = buildCurrencyOptions([], ['ZAR', 'AED']);
      expect(out).toEqual(['AED', 'ZAR']);
    });

    it('returns empty array when both inputs are empty', () => {
      expect(buildCurrencyOptions([], [])).toEqual([]);
    });
  });

  describe('swapPair', () => {
    it('swaps from and to', () => {
      expect(swapPair('EUR', 'USD')).toEqual({ from: 'USD', to: 'EUR' });
    });

    it('handles identical codes (selectable but invalid pair)', () => {
      // Caller is responsible for blocking same-currency submission; swap
      // itself stays a pure no-op for symmetric inputs.
      expect(swapPair('EUR', 'EUR')).toEqual({ from: 'EUR', to: 'EUR' });
    });
  });
});
