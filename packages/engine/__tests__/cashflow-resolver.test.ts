import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { TransactionType } from '@quovibe/shared';
import { resolvePortfolioCashflows, resolveSecurityCashflows } from '../src/cashflow/resolver';
import { convertAmount } from '../src/fx/converter';
import type { TransactionWithUnits } from '@quovibe/shared';

function makeTx(
  overrides: Partial<TransactionWithUnits> & { type: TransactionType },
): TransactionWithUnits {
  return {
    id: 'tx1',
    date: '2024-01-01',
    currencyCode: 'EUR',
    amount: null,
    shares: null,
    note: null,
    securityId: null,
    source: null,
    updatedAt: null,
    units: [],
    ...overrides,
  };
}

/** Build a transaction in ppxml2db convention: amount = net settlement, no GROSS_VALUE unit */
function withUnits(
  type: TransactionType,
  gross: number,
  fees: number,
  taxes: number,
  securityId = 'sec1',
): TransactionWithUnits {
  // ppxml2db convention: BUY/DELIVERY_IN amount = gross + fees + taxes, others = gross - fees - taxes
  const isOutflow = type === TransactionType.BUY || type === TransactionType.DELIVERY_INBOUND;
  const netAmount = isOutflow ? gross + fees + taxes : gross - fees - taxes;
  return makeTx({
    type,
    securityId,
    amount: netAmount,
    units: [
      ...(fees !== 0 ? [{ id: 'u2', transactionId: 'tx1', type: 'FEE' as const, amount: fees, currencyCode: 'EUR', fxAmount: null, fxCurrencyCode: null, fxRate: null }] : []),
      ...(taxes !== 0 ? [{ id: 'u3', transactionId: 'tx1', type: 'TAX' as const, amount: taxes, currencyCode: 'EUR', fxAmount: null, fxCurrencyCode: null, fxRate: null }] : []),
    ],
  });
}

describe('resolveSecurityCashflows', () => {
  it('Buy CF pre-tax: gross=100, fees=3, taxes=2 → +103', () => {
    const tx = withUnits(TransactionType.BUY, 100, 3, 2);
    const [cf] = resolveSecurityCashflows([tx], 'sec1');
    expect(cf.amount.toNumber()).toBe(103);
  });

  it('Buy CF after-tax: gross=100, fees=3, taxes=2 → +105', () => {
    const tx = withUnits(TransactionType.BUY, 100, 3, 2);
    const [cf] = resolveSecurityCashflows([tx], 'sec1', true);
    expect(cf.amount.toNumber()).toBe(105);
  });

  it('Sell CF pre-tax: gross=60, fees=5, taxes=6 → -55', () => {
    const tx = withUnits(TransactionType.SELL, 60, 5, 6);
    const [cf] = resolveSecurityCashflows([tx], 'sec1');
    expect(cf.amount.toNumber()).toBe(-55);
  });

  it('Sell CF after-tax: gross=60, fees=5, taxes=6 → -49', () => {
    const tx = withUnits(TransactionType.SELL, 60, 5, 6);
    const [cf] = resolveSecurityCashflows([tx], 'sec1', true);
    expect(cf.amount.toNumber()).toBe(-49);
  });

  it('Dividend CF pre-tax: gross=15, fees=0, taxes=2 → -15', () => {
    const tx = withUnits(TransactionType.DIVIDEND, 15, 0, 2);
    const [cf] = resolveSecurityCashflows([tx], 'sec1');
    expect(cf.amount.toNumber()).toBe(-15);
  });

  it('filters by securityId — excludes transactions for other securities', () => {
    const tx1 = withUnits(TransactionType.BUY, 100, 0, 0, 'sec1');
    const tx2 = withUnits(TransactionType.BUY, 200, 0, 0, 'sec2');
    const cfs = resolveSecurityCashflows([tx1, tx2], 'sec1');
    expect(cfs).toHaveLength(1);
    expect(cfs[0].amount.toNumber()).toBe(100);
  });
});

describe('resolvePortfolioCashflows', () => {
  it('includes Deposit and Removal, excludes Buy/Sell/Dividend', () => {
    const deposit = makeTx({ type: TransactionType.DEPOSIT, amount: 1000 });
    const removal = makeTx({ type: TransactionType.REMOVAL, amount: 500 });
    const buy = makeTx({ type: TransactionType.BUY, amount: 200, securityId: 'sec1' });
    const dividend = makeTx({ type: TransactionType.DIVIDEND, amount: 50, securityId: 'sec1' });

    const cfs = resolvePortfolioCashflows([deposit, removal, buy, dividend]);
    expect(cfs).toHaveLength(2);
  });

  it('Deposit is positive (inflow)', () => {
    const deposit = makeTx({ type: TransactionType.DEPOSIT, amount: 1000 });
    const [cf] = resolvePortfolioCashflows([deposit]);
    expect(cf.amount.toNumber()).toBeGreaterThan(0);
  });

  it('Removal is negative (outflow)', () => {
    const removal = makeTx({ type: TransactionType.REMOVAL, amount: 500 });
    const [cf] = resolvePortfolioCashflows([removal]);
    expect(cf.amount.toNumber()).toBeLessThan(0);
  });

  it('excludes SECURITY_TRANSFER from portfolio cashflows', () => {
    const transfer = makeTx({ type: TransactionType.SECURITY_TRANSFER, amount: 5000, shares: 100 });
    const deposit = makeTx({ type: TransactionType.DEPOSIT, amount: 1000 });
    const cfs = resolvePortfolioCashflows([transfer, deposit]);
    expect(cfs).toHaveLength(1);
    expect(cfs[0].type).toBe(TransactionType.DEPOSIT);
  });
});

describe('convertAmount (FX)', () => {
  it('multiplies: 100 * 1.10 = 110', () => {
    const result = convertAmount(new Decimal(100), new Decimal('1.10'), 'multiply');
    expect(result.toNumber()).toBe(110);
  });

  it('divides: 100 / 1.10 ≈ 90.909...', () => {
    const result = convertAmount(new Decimal(100), new Decimal('1.10'), 'divide');
    expect(result.toDecimalPlaces(3).toNumber()).toBeCloseTo(90.909, 2);
  });
});
