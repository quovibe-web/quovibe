import { describe, it, expect } from 'vitest';
import { resolveBaseCurrency } from '../resolve-base-currency';

describe('resolveBaseCurrency', () => {
  it('returns EUR when config is undefined', () => {
    expect(resolveBaseCurrency(undefined)).toBe('EUR');
  });

  it('returns EUR when both keys absent', () => {
    expect(resolveBaseCurrency({})).toBe('EUR');
  });

  it('returns canonical baseCurrency when portfolio.currency is absent', () => {
    expect(resolveBaseCurrency({ baseCurrency: 'USD' })).toBe('USD');
  });

  it('returns portfolio.currency override over canonical baseCurrency', () => {
    expect(resolveBaseCurrency({ 'portfolio.currency': 'JPY', baseCurrency: 'USD' })).toBe('JPY');
  });

  it('returns portfolio.currency when canonical is absent', () => {
    expect(resolveBaseCurrency({ 'portfolio.currency': 'GBP' })).toBe('GBP');
  });

  it('falls back to EUR when canonical baseCurrency is empty string', () => {
    expect(resolveBaseCurrency({ baseCurrency: '' })).toBe('EUR');
  });

  it('falls back to EUR when canonical baseCurrency is null', () => {
    expect(resolveBaseCurrency({ baseCurrency: null })).toBe('EUR');
  });
});
