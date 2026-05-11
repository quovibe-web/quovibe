import { describe, it, expect } from 'vitest';
import {
  CROSS_CURRENCY_FX_TYPES,
  CASH_ONLY_ROUTED_TYPES,
  PRICED_SHARE_TYPES,
  SECURITY_REQUIRED_TYPES,
  AMOUNT_REQUIRED_TYPES,
  isTransactionTypeAllowed,
  getAvailableTransactionTypes,
} from '../transaction-gating';
import { AccountType, TransactionType } from '../enums';

describe('transaction-gating — CROSS_CURRENCY_FX_TYPES membership', () => {
  // Types whose cross-currency leg makes `fxRate` mandatory at the route
  // layer. Membership rationale lives in the source comment; this test
  // pins the set so future contributors cannot quietly drop a type and
  // re-open the silent-mis-recording class of bug.
  it('contains BUY, SELL, DIVIDEND, TRANSFER_BETWEEN_ACCOUNTS', () => {
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.BUY)).toBe(true);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.SELL)).toBe(true);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.DIVIDEND)).toBe(true);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.TRANSFER_BETWEEN_ACCOUNTS)).toBe(true);
  });

  it('excludes types that have no cross-currency leg', () => {
    // Cash-only single-leg types (no second currency to compare against).
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.DEPOSIT)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.REMOVAL)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.INTEREST)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.INTEREST_CHARGE)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.FEES)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.FEES_REFUND)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.TAXES)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.TAX_REFUND)).toBe(false);

    // Share-only delivery types — they carry a security but no cash leg.
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.DELIVERY_INBOUND)).toBe(false);
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.DELIVERY_OUTBOUND)).toBe(false);
    // SECURITY_TRANSFER is portfolio→portfolio with the same security; no FX leg.
    expect(CROSS_CURRENCY_FX_TYPES.has(TransactionType.SECURITY_TRANSFER)).toBe(false);
  });

  it('every member of CROSS_CURRENCY_FX_TYPES also requires a positive amount', () => {
    // Sanity: a cross-currency leg is meaningless without an amount, so the
    // FX gate must not apply to any type the schema lets through with
    // amount = 0.
    for (const t of CROSS_CURRENCY_FX_TYPES) {
      expect(AMOUNT_REQUIRED_TYPES.has(t)).toBe(true);
    }
  });
});

describe('transaction-gating — sanity checks on related sets', () => {
  it('CASH_ONLY_ROUTED_TYPES contains DIVIDEND', () => {
    // The route layer auto-routes a portfolio `accountId` to the portfolio's
    // `referenceAccount` for DIVIDEND. Removing DIVIDEND here would force
    // the 422 "TRANSACTION_TYPE_NOT_ALLOWED_FOR_SOURCE" guard to fire on a
    // legitimate dividend posted against a portfolio source.
    expect(CASH_ONLY_ROUTED_TYPES.has(TransactionType.DIVIDEND)).toBe(true);
  });

  it('SECURITY_REQUIRED_TYPES is a superset of PRICED_SHARE_TYPES + DIVIDEND', () => {
    for (const t of PRICED_SHARE_TYPES) {
      expect(SECURITY_REQUIRED_TYPES.has(t)).toBe(true);
    }
    expect(SECURITY_REQUIRED_TYPES.has(TransactionType.DIVIDEND)).toBe(true);
  });

  it('isTransactionTypeAllowed permits DIVIDEND on both account types', () => {
    expect(isTransactionTypeAllowed(AccountType.SECURITIES, TransactionType.DIVIDEND)).toBe(true);
    expect(isTransactionTypeAllowed(AccountType.DEPOSIT, TransactionType.DIVIDEND)).toBe(true);
  });

  it('getAvailableTransactionTypes returns the matching list per account type', () => {
    const sec = getAvailableTransactionTypes(AccountType.SECURITIES);
    const dep = getAvailableTransactionTypes(AccountType.DEPOSIT);
    expect(sec).toContain(TransactionType.BUY);
    expect(sec).toContain(TransactionType.SELL);
    expect(sec).toContain(TransactionType.DIVIDEND);
    expect(sec).not.toContain(TransactionType.TRANSFER_BETWEEN_ACCOUNTS);
    expect(dep).toContain(TransactionType.DEPOSIT);
    expect(dep).toContain(TransactionType.TRANSFER_BETWEEN_ACCOUNTS);
    expect(dep).not.toContain(TransactionType.BUY);
    expect(dep).not.toContain(TransactionType.SELL);
  });
});
