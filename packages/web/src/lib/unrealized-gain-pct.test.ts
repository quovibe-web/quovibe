import { describe, it, expect } from 'vitest';
import { resolveUnrealizedGainPct } from './unrealized-gain-pct';

// Cross-currency shape taken from the service fixture: USD position up 5 % in
// its own currency, down in EUR because USD weakened more than the quote rose.
const CROSS = {
  unrealizedBase: '-26',
  costBase: '950',
  unrealizedNative: '50',
  purchaseValueNative: '1000',
  baseCurrency: 'EUR',
  nativeCurrency: 'USD',
} as const;

describe('resolveUnrealizedGainPct', () => {
  it('uses the base pair in base view', () => {
    expect(resolveUnrealizedGainPct({ ...CROSS, view: 'base' })).toBeCloseTo(-26 / 950, 10);
  });

  it('uses the native pair in native view', () => {
    expect(resolveUnrealizedGainPct({ ...CROSS, view: 'native' })).toBeCloseTo(0.05, 10);
  });

  it('keeps the sign aligned with the amount rendered beside it', () => {
    expect(resolveUnrealizedGainPct({ ...CROSS, view: 'base' })!).toBeLessThan(0);
    expect(resolveUnrealizedGainPct({ ...CROSS, view: 'native' })!).toBeGreaterThan(0);
  });

  it('falls back to base when the security has no distinct native currency', () => {
    const sameCcy = { ...CROSS, nativeCurrency: 'EUR', view: 'native' } as const;
    expect(resolveUnrealizedGainPct(sameCcy)).toBeCloseTo(-26 / 950, 10);
  });

  it('falls back to base when the native currency is unknown', () => {
    const noCcy = { ...CROSS, nativeCurrency: null, view: 'native' } as const;
    expect(resolveUnrealizedGainPct(noCcy)).toBeCloseTo(-26 / 950, 10);
  });

  it('returns null on a zero cost basis', () => {
    expect(resolveUnrealizedGainPct({ ...CROSS, costBase: '0', view: 'base' })).toBeNull();
    expect(
      resolveUnrealizedGainPct({ ...CROSS, purchaseValueNative: '0', view: 'native' }),
    ).toBeNull();
  });

  it('returns null on unparseable input', () => {
    expect(resolveUnrealizedGainPct({ ...CROSS, costBase: '', view: 'base' })).toBeNull();
  });
});
