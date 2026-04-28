import { describe, expect, it } from 'vitest';
import { TransactionType } from '@quovibe/shared';
import { deriveFxCurrencies } from '../transaction-form-fx.utils';

describe('deriveFxCurrencies', () => {
  it('BUY cross-currency: src=cash, dst=security', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.BUY,
      sourceAccount: { currency: 'EUR' },
      crossAccount: { currency: 'EUR' },
      security: { currency: 'USD' },
    });
    expect(r).toEqual({ srcCurrency: 'EUR', dstCurrency: 'USD', isCrossCurrency: true });
  });

  it('BUY same-currency: not cross', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.BUY,
      sourceAccount: { currency: 'EUR' },
      crossAccount: { currency: 'EUR' },
      security: { currency: 'EUR' },
    });
    expect(r.isCrossCurrency).toBe(false);
  });

  it('SELL: src derived from crossAccount, dst from security', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.SELL,
      sourceAccount: { currency: 'EUR' },
      crossAccount: { currency: 'USD' },
      security: { currency: 'USD' },
    });
    expect(r).toEqual({ srcCurrency: 'USD', dstCurrency: 'USD', isCrossCurrency: false });
  });

  it('SELL cross-currency: crossAccount EUR vs security USD', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.SELL,
      sourceAccount: { currency: 'EUR' },
      crossAccount: { currency: 'EUR' },
      security: { currency: 'USD' },
    });
    expect(r).toEqual({ srcCurrency: 'EUR', dstCurrency: 'USD', isCrossCurrency: true });
  });

  it('TRANSFER_BETWEEN_ACCOUNTS cross-currency: src=source, dst=cross', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      sourceAccount: { currency: 'EUR' },
      crossAccount: { currency: 'USD' },
      security: null,
    });
    expect(r).toEqual({ srcCurrency: 'EUR', dstCurrency: 'USD', isCrossCurrency: true });
  });

  it('TRANSFER_BETWEEN_ACCOUNTS same-currency: not cross', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      sourceAccount: { currency: 'EUR' },
      crossAccount: { currency: 'EUR' },
      security: null,
    });
    expect(r.isCrossCurrency).toBe(false);
  });

  it('DEPOSIT: returns null currencies', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.DEPOSIT,
      sourceAccount: { currency: 'EUR' },
      crossAccount: null,
      security: null,
    });
    expect(r).toEqual({ srcCurrency: null, dstCurrency: null, isCrossCurrency: false });
  });

  it('BUY with missing crossAccount: not cross', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.BUY,
      sourceAccount: { currency: 'EUR' },
      crossAccount: null,
      security: { currency: 'USD' },
    });
    expect(r.isCrossCurrency).toBe(false);
  });

  it('TRANSFER with missing crossAccount: not cross', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      sourceAccount: { currency: 'EUR' },
      crossAccount: null,
      security: null,
    });
    expect(r.isCrossCurrency).toBe(false);
  });
});
