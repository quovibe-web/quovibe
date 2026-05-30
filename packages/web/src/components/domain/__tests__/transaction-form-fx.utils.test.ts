import { describe, expect, it } from 'vitest';
import { CROSS_CURRENCY_FX_TYPES, TransactionType } from '@quovibe/shared';
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

  it('DIVIDEND cross-currency: src=deposit (sourceAccount), dst=security', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.DIVIDEND,
      sourceAccount: { currency: 'EUR' },
      crossAccount: null,
      security: { currency: 'GBP' },
    });
    expect(r).toEqual({ srcCurrency: 'EUR', dstCurrency: 'GBP', isCrossCurrency: true });
  });

  it('DIVIDEND same-currency: not cross', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.DIVIDEND,
      sourceAccount: { currency: 'EUR' },
      crossAccount: null,
      security: { currency: 'EUR' },
    });
    expect(r.isCrossCurrency).toBe(false);
  });

  it('DIVIDEND with missing security: not cross', () => {
    const r = deriveFxCurrencies({
      type: TransactionType.DIVIDEND,
      sourceAccount: { currency: 'EUR' },
      crossAccount: null,
      security: null,
    });
    expect(r.isCrossCurrency).toBe(false);
  });

  // Drift guard: every type the shared route-gate treats as cross-currency
  // MUST have a derivation rule here, or the FX field never renders and the
  // server's FX_RATE_REQUIRED becomes unfixable from the UI. Replaces the
  // prose "keep in sync" comment that failed to stop DIVIDEND drifting.
  it('every CROSS_CURRENCY_FX_TYPES member resolves cross when currencies differ', () => {
    for (const type of CROSS_CURRENCY_FX_TYPES) {
      const r = deriveFxCurrencies({
        type,
        sourceAccount: { currency: 'EUR' },
        crossAccount: { currency: 'USD' },
        security: { currency: 'GBP' },
      });
      expect(r.isCrossCurrency, `${type} needs a derivation rule in deriveFxCurrencies`).toBe(true);
    }
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
