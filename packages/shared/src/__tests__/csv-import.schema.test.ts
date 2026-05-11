import { describe, it, expect } from 'vitest';
import {
  reparseTradesSchema,
  tradePreviewSchema,
  tradeExecuteSchema,
} from '../schemas/csv-import.schema';

describe('reparseTradesSchema', () => {
  it('accepts tempFileId only', () => {
    expect(reparseTradesSchema.safeParse({ tempFileId: 'abc' }).success).toBe(true);
  });

  it('accepts tempFileId + delimiter + skipLines', () => {
    const result = reparseTradesSchema.safeParse({
      tempFileId: 'abc', delimiter: ';', skipLines: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown delimiter', () => {
    expect(reparseTradesSchema.safeParse({ tempFileId: 'abc', delimiter: '#' }).success).toBe(false);
  });

  it('rejects negative skipLines', () => {
    expect(reparseTradesSchema.safeParse({ tempFileId: 'abc', skipLines: -1 }).success).toBe(false);
  });

  it('rejects extra wire fields (strict)', () => {
    expect(reparseTradesSchema.safeParse({ tempFileId: 'abc', extra: 1 }).success).toBe(false);
  });
});

describe('tradePreviewSchema', () => {
  const minValid = {
    tempFileId: 'abc',
    columnMapping: { date: 0, amount: 1 },
    dateFormat: 'yyyy-MM-dd' as const,
    decimalSeparator: '.' as const,
    thousandSeparator: ',' as const,
    targetSecuritiesAccountId: 'uuid-1',
  };

  it('accepts a minimal valid preview body', () => {
    expect(tradePreviewSchema.safeParse(minValid).success).toBe(true);
  });

  it('rejects unknown decimal separator', () => {
    expect(tradePreviewSchema.safeParse({ ...minValid, decimalSeparator: '*' }).success).toBe(false);
  });

  it('rejects unknown date format', () => {
    expect(tradePreviewSchema.safeParse({ ...minValid, dateFormat: 'foo' }).success).toBe(false);
  });

  it('rejects empty targetSecuritiesAccountId', () => {
    expect(tradePreviewSchema.safeParse({ ...minValid, targetSecuritiesAccountId: '' }).success).toBe(false);
  });
});

describe('tradeExecuteSchema', () => {
  const minValid = {
    tempFileId: 'abc',
    config: {
      columnMapping: { date: 0, amount: 1 },
      dateFormat: 'yyyy-MM-dd' as const,
      decimalSeparator: '.' as const,
      thousandSeparator: ',' as const,
    },
    targetSecuritiesAccountId: 'uuid-1',
    securityMapping: {},
    newSecurities: [],
    excludedRows: [],
  };

  it('accepts a minimal valid execute body and defaults delimiter to comma', () => {
    const result = tradeExecuteSchema.safeParse(minValid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.config.delimiter).toBe(',');
  });

  it('accepts a newSecurities entry with isin + ticker', () => {
    const body = {
      ...minValid,
      newSecurities: [{ name: 'NVDA', isin: 'US67066G1040', ticker: 'NVDA', currency: 'USD' }],
    };
    expect(tradeExecuteSchema.safeParse(body).success).toBe(true);
  });

  it('rejects newSecurities entry with empty name', () => {
    const body = {
      ...minValid,
      newSecurities: [{ name: '', currency: 'USD' }],
    };
    expect(tradeExecuteSchema.safeParse(body).success).toBe(false);
  });
});
