// packages/shared/src/csv/infer-type.test.ts
import { describe, it, expect } from 'vitest';
import { inferTransactionType } from './infer-type';
import { TransactionType } from '../enums';

describe('inferTransactionType', () => {
  it('positive amount + has security → DIVIDEND', () => {
    expect(inferTransactionType(150.0, true)).toBe(TransactionType.DIVIDEND);
  });

  it('negative amount + has security → REMOVAL', () => {
    expect(inferTransactionType(-150.0, true)).toBe(TransactionType.REMOVAL);
  });

  it('positive amount + no security → DEPOSIT', () => {
    expect(inferTransactionType(1000.0, false)).toBe(TransactionType.DEPOSIT);
  });

  it('negative amount + no security → REMOVAL', () => {
    expect(inferTransactionType(-500.0, false)).toBe(TransactionType.REMOVAL);
  });

  it('zero amount + has security → DEPOSIT (fallback)', () => {
    expect(inferTransactionType(0, true)).toBe(TransactionType.DEPOSIT);
  });

  it('zero amount + no security → DEPOSIT (fallback)', () => {
    expect(inferTransactionType(0, false)).toBe(TransactionType.DEPOSIT);
  });

  it('handles small positive amounts (cents)', () => {
    expect(inferTransactionType(0.01, true)).toBe(TransactionType.DIVIDEND);
    expect(inferTransactionType(0.01, false)).toBe(TransactionType.DEPOSIT);
  });

  it('handles small negative amounts (cents)', () => {
    expect(inferTransactionType(-0.01, true)).toBe(TransactionType.REMOVAL);
    expect(inferTransactionType(-0.01, false)).toBe(TransactionType.REMOVAL);
  });
});
