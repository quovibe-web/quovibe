import { describe, it, expect } from 'vitest';
import {
  buildSplitFormSchema,
  describeSplit,
  toSplitRequest,
  type SplitFormValues,
} from '../stock-split-form.schema';

const t = (key: string) => key;
const schema = buildSplitFormSchema(t);

const base: SplitFormValues = {
  securityId: '11111111-1111-4111-8111-111111111111',
  exDate: '2026-07-16',
  oldShares: '25',
  newShares: '1',
};

describe('buildSplitFormSchema', () => {
  it('accepts a reverse split', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('accepts comma decimal separators', () => {
    expect(schema.safeParse({ ...base, newShares: '2,1796', oldShares: '1' }).success).toBe(true);
  });

  it('rejects an empty security', () => {
    expect(schema.safeParse({ ...base, securityId: '' }).success).toBe(false);
  });

  it.each(['', '0', '-1', 'abc'])('rejects newShares = %s', (newShares) => {
    expect(schema.safeParse({ ...base, newShares }).success).toBe(false);
  });

  it.each(['', '0', '-1', 'abc'])('rejects oldShares = %s', (oldShares) => {
    expect(schema.safeParse({ ...base, oldShares }).success).toBe(false);
  });

  it('rejects a 1:1 ratio', () => {
    expect(schema.safeParse({ ...base, newShares: '3', oldShares: '3' }).success).toBe(false);
  });

  it.each(['2026-7-16', '16/07/2026', ''])('rejects exDate %s', (exDate) => {
    expect(schema.safeParse({ ...base, exDate }).success).toBe(false);
  });
});

describe('describeSplit', () => {
  it('labels a forward split', () => {
    const d = describeSplit({ newShares: '20', oldShares: '1' });
    expect(d?.key).toBe('split.direction.forward');
    expect(d?.values).toEqual({ oldShares: '1', newShares: '20' });
  });

  it('labels a reverse split', () => {
    const d = describeSplit({ newShares: '1', oldShares: '25' });
    expect(d?.key).toBe('split.direction.reverse');
    expect(d?.values).toEqual({ oldShares: '25', newShares: '1' });
  });

  it('labels a no-op ratio', () => {
    expect(describeSplit({ newShares: '3', oldShares: '3' })?.key).toBe('split.direction.noop');
  });

  it('returns null for incomplete input', () => {
    expect(describeSplit({ newShares: '', oldShares: '25' })).toBeNull();
    expect(describeSplit({ newShares: 'abc', oldShares: '1' })).toBeNull();
  });

  it('normalises comma decimals', () => {
    expect(describeSplit({ newShares: '2,1796', oldShares: '1' })?.key).toBe(
      'split.direction.forward',
    );
  });
});

describe('toSplitRequest', () => {
  it('converts form strings to the wire numbers and carries the flags', () => {
    expect(toSplitRequest(base, { changeTransactions: true, changeHistoricalQuotes: false })).toEqual(
      {
        securityId: base.securityId,
        exDate: '2026-07-16',
        newShares: 1,
        oldShares: 25,
        changeTransactions: true,
        changeHistoricalQuotes: false,
      },
    );
  });

  it('normalises comma decimals into the wire numbers', () => {
    const req = toSplitRequest(
      { ...base, newShares: '2,1796', oldShares: '1' },
      { changeTransactions: true, changeHistoricalQuotes: true },
    );
    expect(req.newShares).toBe(2.1796);
  });
});
