import { describe, it, expect } from 'vitest';
import { preparePayload } from './transaction-payload';
import { TransactionType } from './enums';
import type { TransactionFormValues } from '@/components/domain/TransactionForm';

function base(overrides: Partial<TransactionFormValues>): TransactionFormValues {
  return {
    type: TransactionType.BUY,
    date: '2026-04-24T09:00',
    shares: '',
    price: '',
    amount: '',
    fees: '',
    taxes: '',
    accountId: 'acc-1',
    note: '',
    ...overrides,
  } as TransactionFormValues;
}

describe('preparePayload', () => {
  it('BUY: derives amount = shares × price', () => {
    const p = preparePayload(base({ type: TransactionType.BUY, shares: '3', price: '10' }));
    expect(p.amount).toBe(30);
    expect(p.shares).toBe(3);
  });

  it('SECURITY_TRANSFER: derives amount = shares × price (PP quote-price convention)', () => {
    const p = preparePayload(
      base({
        type: TransactionType.SECURITY_TRANSFER,
        shares: '5',
        price: '12.5',
        accountId: 'src-portfolio',
        crossAccountId: 'dst-portfolio',
        securityId: 'sec-1',
      }),
    );
    expect(p.amount).toBe(62.5);
    expect(p.shares).toBe(5);
    expect(p.crossAccountId).toBe('dst-portfolio');
  });

  it('DEPOSIT: uses user-entered amount directly (no price derivation)', () => {
    const p = preparePayload(base({ type: TransactionType.DEPOSIT, amount: '100' }));
    expect(p.amount).toBe(100);
    expect(p.shares).toBeUndefined();
  });
});
