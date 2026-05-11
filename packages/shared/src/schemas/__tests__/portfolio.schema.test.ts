import { describe, it, expect } from 'vitest';
import { importSummarySchema, type ImportSummary } from '../portfolio.schema';

describe('importSummarySchema', () => {
  it('accepts a fully-populated summary with non-negative integers', () => {
    const ok = importSummarySchema.parse({ accounts: 3, securities: 12, transactions: 847 });
    expect(ok).toEqual({ accounts: 3, securities: 12, transactions: 847 });
  });

  it('accepts zero counts (empty portfolio)', () => {
    const ok = importSummarySchema.parse({ accounts: 0, securities: 0, transactions: 0 });
    expect(ok).toEqual({ accounts: 0, securities: 0, transactions: 0 });
  });

  it('rejects negative counts', () => {
    expect(() =>
      importSummarySchema.parse({ accounts: -1, securities: 0, transactions: 0 }),
    ).toThrow();
  });

  it('rejects fractional counts', () => {
    expect(() =>
      importSummarySchema.parse({ accounts: 1.5, securities: 0, transactions: 0 }),
    ).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      importSummarySchema.parse({
        accounts: 0, securities: 0, transactions: 0, dashboards: 1,
      }),
    ).toThrow();
  });

  it('rejects missing keys', () => {
    expect(() =>
      importSummarySchema.parse({ accounts: 0, securities: 0 }),
    ).toThrow();
  });
});
