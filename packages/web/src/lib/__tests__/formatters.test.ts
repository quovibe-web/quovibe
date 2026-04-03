import { describe, it, expect } from 'vitest';
import { formatCurrency, formatShares, formatQuote } from '@/lib/formatters';

describe('formatCurrency', () => {
  it('uses currency symbol by default', () => {
    const result = formatCurrency(1234.56, 'EUR');
    // Default: symbol style (€)
    expect(result).not.toContain('EUR');
  });

  it('uses ISO code when showCurrencyCode is true', () => {
    const result = formatCurrency(1234.56, 'EUR', { showCurrencyCode: true });
    expect(result).toContain('EUR');
  });

  it('uses symbol when showCurrencyCode is false', () => {
    const result = formatCurrency(1234.56, 'EUR', { showCurrencyCode: false });
    expect(result).not.toContain('EUR');
  });

  it('works with USD', () => {
    const result = formatCurrency(99.99, 'USD', { showCurrencyCode: true });
    expect(result).toContain('USD');
  });
});

describe('formatShares', () => {
  it('uses default precision (4) without options', () => {
    const result = formatShares(1.5678);
    // Default 4 decimals
    expect(result).toMatch(/1[.,]5678/);
  });

  it('uses sharesPrecision = 1', () => {
    const result = formatShares(1.5678, { sharesPrecision: 1 });
    // Should round to 1 decimal
    expect(result).toMatch(/1[.,]6/);
    // Should not have 4 decimal places
    expect(result).not.toMatch(/1[.,]5678/);
  });

  it('uses sharesPrecision = 3', () => {
    const result = formatShares(1.5678, { sharesPrecision: 3 });
    expect(result).toMatch(/1[.,]568/);
  });

  it('shows integers without decimals', () => {
    const result = formatShares(5, { sharesPrecision: 2 });
    // Integer values show 0 fraction digits
    expect(result).toMatch(/^5$/);
  });
});

describe('formatQuote', () => {
  it('uses default precision (2)', () => {
    const result = formatQuote(12.3456);
    expect(result).toMatch(/12[.,]35/);
  });

  it('uses quotesPrecision = 4', () => {
    const result = formatQuote(12.3456, { quotesPrecision: 4 });
    expect(result).toMatch(/12[.,]3456/);
  });

  it('uses quotesPrecision = 0', () => {
    const result = formatQuote(12.3456, { quotesPrecision: 0 });
    expect(result).toBe('12');
  });
});
