import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { getGrossAmount, getFees, getTaxes, getNetAmount } from '../../src/helpers/transaction-amounts';
import { TransactionWithUnits, TransactionType } from '@quovibe/shared';

const unit = (type: TransactionWithUnits['units'][0]['type'], amount: number): TransactionWithUnits['units'][0] => ({
  id: 'u', transactionId: '1', type, amount, currencyCode: 'EUR', fxAmount: null, fxCurrencyCode: null, fxRate: null,
});

function makeTx(
  type: TransactionType,
  amount: number | null,
  units: TransactionWithUnits['units'] = [],
): TransactionWithUnits {
  return {
    id: '1',
    type,
    date: '2024-01-01',
    currencyCode: 'EUR',
    amount,
    shares: null,
    note: null,
    securityId: null,
    source: null,
    updatedAt: null,
    units,
  };
}

describe('getGrossAmount', () => {
  it('returns amount when no fee/tax units (e.g. DEPOSIT)', () => {
    const tx = makeTx(TransactionType.DEPOSIT, 8000);
    expect(getGrossAmount(tx).toNumber()).toBe(8000);
  });

  it('returns 0 when tx.amount is null', () => {
    const tx = makeTx(TransactionType.BUY, null);
    expect(getGrossAmount(tx).toNumber()).toBe(0);
  });

  // ppxml2db stores BUY amount = gross + fees + taxes (total outlay)
  it('reconstructs gross for BUY: amount - fees - taxes', () => {
    // BUY: amount = 1055 = gross(1000) + fees(30) + taxes(25)
    const tx = makeTx(TransactionType.BUY, 1055, [unit('FEE', 30), unit('TAX', 25)]);
    expect(getGrossAmount(tx).toNumber()).toBe(1000);
  });

  // ppxml2db stores SELL amount = gross - fees - taxes (net inflow)
  it('reconstructs gross for SELL: amount + fees + taxes', () => {
    // SELL: amount = 945 = gross(1000) - fees(30) - taxes(25)
    const tx = makeTx(TransactionType.SELL, 945, [unit('FEE', 30), unit('TAX', 25)]);
    expect(getGrossAmount(tx).toNumber()).toBe(1000);
  });

  it('reconstructs gross for DIVIDEND: amount + fees + taxes', () => {
    // DIVIDEND: amount = 85 = gross(100) - fees(5) - taxes(10)
    const tx = makeTx(TransactionType.DIVIDEND, 85, [unit('FEE', 5), unit('TAX', 10)]);
    expect(getGrossAmount(tx).toNumber()).toBe(100);
  });

  it('reconstructs gross for DELIVERY_INBOUND: amount - fees - taxes', () => {
    // DELIVERY_INBOUND: amount = 1055 = gross(1000) + fees(30) + taxes(25)
    const tx = makeTx(TransactionType.DELIVERY_INBOUND, 1055, [unit('FEE', 30), unit('TAX', 25)]);
    expect(getGrossAmount(tx).toNumber()).toBe(1000);
  });
});

describe('getFees', () => {
  it('returns 0 when no FEE units', () => {
    const tx = makeTx(TransactionType.BUY, 100);
    expect(getFees(tx).toNumber()).toBe(0);
  });

  it('returns single fee', () => {
    const tx = makeTx(TransactionType.BUY, 100, [unit('FEE', 9.99)]);
    expect(getFees(tx).toNumber()).toBeCloseTo(9.99);
  });

  it('sums multiple FEE units', () => {
    const tx = makeTx(TransactionType.BUY, 100, [unit('FEE', 5), unit('FEE', 3)]);
    expect(getFees(tx).toNumber()).toBe(8);
  });
});

describe('getTaxes', () => {
  it('returns 0 when no TAX units', () => {
    expect(getTaxes(makeTx(TransactionType.BUY, 100)).toNumber()).toBe(0);
  });

  it('sums TAX units', () => {
    const tx = makeTx(TransactionType.BUY, 100, [unit('TAX', 10), unit('TAX', 5)]);
    expect(getTaxes(tx).toNumber()).toBe(15);
  });
});

describe('getNetAmount', () => {
  // ppxml2db round-trip: net amount equals tx.amount
  it('BUY: getNetAmount returns tx.amount (round-trip)', () => {
    // BUY: amount(1055) = gross(1000) + fees(30) + taxes(25)
    const tx = makeTx(TransactionType.BUY, 1055, [unit('FEE', 30), unit('TAX', 25)]);
    expect(getNetAmount(tx).toNumber()).toBe(1055);
  });

  it('SELL: getNetAmount returns tx.amount (round-trip)', () => {
    // SELL: amount(945) = gross(1000) - fees(30) - taxes(25)
    const tx = makeTx(TransactionType.SELL, 945, [unit('FEE', 30), unit('TAX', 25)]);
    expect(getNetAmount(tx).toNumber()).toBe(945);
  });

  it('DEPOSIT: getNetAmount returns tx.amount', () => {
    const tx = makeTx(TransactionType.DEPOSIT, 5000);
    expect(getNetAmount(tx).toNumber()).toBe(5000);
  });
});
