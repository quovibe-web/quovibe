import { describe, it, expect } from 'vitest';
import { stockSplitSchema } from './stock-split.schema';

const base = {
  securityId: '11111111-1111-4111-8111-111111111111',
  exDate: '2026-07-16',
  newShares: 1,
  oldShares: 25,
};

describe('stockSplitSchema', () => {
  it('accepts a reverse split and defaults both apply flags to true', () => {
    const parsed = stockSplitSchema.parse(base);
    expect(parsed.changeTransactions).toBe(true);
    expect(parsed.changeHistoricalQuotes).toBe(true);
  });

  it('accepts explicit false flags', () => {
    const parsed = stockSplitSchema.parse({
      ...base,
      changeTransactions: false,
      changeHistoricalQuotes: false,
    });
    expect(parsed.changeTransactions).toBe(false);
  });

  it('accepts fractional ratio sides', () => {
    expect(() => stockSplitSchema.parse({ ...base, newShares: 2.1796, oldShares: 1 })).not.toThrow();
  });

  it('rejects a 1:1 no-op ratio', () => {
    expect(() => stockSplitSchema.parse({ ...base, newShares: 3, oldShares: 3 })).toThrow();
  });

  it.each([0, -1])('rejects newShares = %s', (newShares) => {
    expect(() => stockSplitSchema.parse({ ...base, newShares })).toThrow();
  });

  it.each([0, -1])('rejects oldShares = %s', (oldShares) => {
    expect(() => stockSplitSchema.parse({ ...base, oldShares })).toThrow();
  });

  it.each(['2026-7-16', '16/07/2026', '2026-07-16T00:00:00'])('rejects exDate %s', (exDate) => {
    expect(() => stockSplitSchema.parse({ ...base, exDate })).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => stockSplitSchema.parse({ ...base, ratio: '1:25' })).toThrow();
  });
});
