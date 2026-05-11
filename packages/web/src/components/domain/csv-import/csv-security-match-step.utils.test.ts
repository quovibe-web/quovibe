import { describe, it, expect } from 'vitest';
import { resolveNewSecurityCurrency } from './csv-security-match-step.utils';

describe('resolveNewSecurityCurrency', () => {
  it('user override wins over CGA + portfolio fallback', () => {
    expect(resolveNewSecurityCurrency(['USD'], 'EUR', 'GBP')).toBe('GBP');
  });

  it('single CGA wins over portfolio fallback', () => {
    expect(resolveNewSecurityCurrency(['USD'], 'EUR', undefined)).toBe('USD');
  });

  it('empty CGA → portfolio fallback', () => {
    expect(resolveNewSecurityCurrency([], 'EUR', undefined)).toBe('EUR');
  });

  it('multiple CGA values + no override → portfolio fallback', () => {
    expect(resolveNewSecurityCurrency(['EUR', 'USD'], 'EUR', undefined)).toBe('EUR');
  });

  it('override of empty string is treated as no override', () => {
    expect(resolveNewSecurityCurrency(['USD'], 'EUR', '')).toBe('USD');
  });

  it('override wins even when CGA conflicts', () => {
    expect(resolveNewSecurityCurrency(['EUR', 'USD'], 'EUR', 'CHF')).toBe('CHF');
  });
});
