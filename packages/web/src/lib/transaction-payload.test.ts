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

  // The schema accepts a locale comma after normalizeDecimalInput; the payload
  // must normalize identically or a bare parseFloat("1,5") would post 1 and
  // silently drop the fraction for es/it/de/fr/nl/pl/pt users.
  it('normalizes locale comma decimals on every numeric field', () => {
    const p = preparePayload(
      base({
        type: TransactionType.BUY,
        shares: '1,5',
        price: '10,5',
        fees: '0,25',
        taxes: '0,10',
        securityId: 'sec-1',
        crossAccountId: 'acc-2',
      }),
    );
    expect(p.shares).toBe(1.5);
    expect(p.amount).toBe(15.75); // 1.5 × 10.5, not 1 × 10
    expect(p.fees).toBe(0.25);
    expect(p.taxes).toBe(0.1);
  });

  it('DEPOSIT: normalizes a comma amount (no price derivation path)', () => {
    const p = preparePayload(base({ type: TransactionType.DEPOSIT, amount: '100,50' }));
    expect(p.amount).toBe(100.5);
  });
});
