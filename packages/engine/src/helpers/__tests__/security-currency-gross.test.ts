// Reference: docs/architecture/multi-currency.md — security-currency
// gross resolution priority (same-currency → FX-decorated unit
// (type=GROSS_VALUE or type=FOREX) → vf_exchange_rate fallback → null).
// Pins the engine-side primitive. The dual-type acceptance is critical:
// ppxml2db emits GROSS_VALUE from PP's XML attribute; quovibe-native
// writes via transaction.service.ts emit FOREX. Same payload shape.

import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  TransactionType,
  type TransactionWithUnits,
  type TransactionUnit,
} from '@quovibe/shared';
import { getSecurityCurrencyGross } from '../transaction-amounts';

const d = (v: string | number) => new Decimal(v);

function tx(
  type: TransactionType,
  amount: number,
  currencyCode: string,
  units: TransactionUnit[] = [],
): TransactionWithUnits {
  return {
    id: 't1',
    type,
    date: '2025-01-15',
    currencyCode,
    amount,
    shares: 1e8,
    note: null,
    securityId: 's1',
    source: null,
    updatedAt: null,
    units,
  };
}

function grossValueUnit(
  amount: number,
  currencyCode: string,
  fxAmount: number,
  fxCurrencyCode: string,
  fxRate: number,
): TransactionUnit {
  return {
    id: 'u1',
    transactionId: 't1',
    type: 'GROSS_VALUE',
    amount,
    currencyCode,
    fxAmount,
    fxCurrencyCode,
    fxRate,
  };
}

function forexUnit(
  amount: number,
  currencyCode: string,
  fxAmount: number,
  fxCurrencyCode: string,
  fxRate: number,
): TransactionUnit {
  return {
    id: 'u1',
    transactionId: 't1',
    type: 'FOREX',
    amount,
    currencyCode,
    fxAmount,
    fxCurrencyCode,
    fxRate,
  };
}

describe('getSecurityCurrencyGross', () => {
  test('same-currency BUY returns getGrossAmount unchanged', () => {
    const t = tx(TransactionType.BUY, 1000, 'EUR');
    const result = getSecurityCurrencyGross(t, 'EUR');
    expect(result).not.toBeNull();
    expect(result!.equals(d(1000))).toBe(true);
  });

  test('cross-currency BUY with GROSS_VALUE FOREX unit returns forex_amount', () => {
    const t = tx(TransactionType.BUY, 366.6, 'EUR', [
      grossValueUnit(366.6, 'EUR', 403.26, 'USD', 1.1),
    ]);
    const result = getSecurityCurrencyGross(t, 'USD');
    expect(result).not.toBeNull();
    expect(result!.toFixed(2)).toBe('403.26');
  });

  test('cross-currency BUY without FOREX unit falls back to fallbackRate', () => {
    const t = tx(TransactionType.BUY, 366.6, 'EUR');
    const result = getSecurityCurrencyGross(t, 'USD', d(1.1));
    expect(result).not.toBeNull();
    expect(result!.toFixed(2)).toBe('403.26');
  });

  test('cross-currency BUY without FOREX unit and no fallback returns null', () => {
    const t = tx(TransactionType.BUY, 366.6, 'EUR');
    const result = getSecurityCurrencyGross(t, 'USD');
    expect(result).toBeNull();
  });

  test('FOREX unit with mismatching fxCurrencyCode is ignored', () => {
    const t = tx(TransactionType.BUY, 1000, 'EUR', [
      grossValueUnit(1000, 'EUR', 850, 'GBP', 0.85),
    ]);
    const result = getSecurityCurrencyGross(t, 'USD', d(1.1));
    expect(result).not.toBeNull();
    expect(result!.toFixed(2)).toBe('1100.00');
  });

  test('user-reported scenario: USD security bought in EUR (366.60 EUR @ 1.10)', () => {
    const t = tx(TransactionType.BUY, 366.6, 'EUR', [
      grossValueUnit(366.6, 'EUR', 403.26, 'USD', 1.1),
    ]);
    const result = getSecurityCurrencyGross(t, 'USD');
    expect(result!.toFixed(2)).toBe('403.26');
  });

  test('user-reported scenario: 2-share BUY (806.60 EUR @ 1.05)', () => {
    const t = tx(TransactionType.BUY, 806.6, 'EUR', [
      grossValueUnit(806.6, 'EUR', 846.93, 'USD', 1.05),
    ]);
    const result = getSecurityCurrencyGross(t, 'USD');
    expect(result!.toFixed(2)).toBe('846.93');
  });

  test('null amount returns null', () => {
    const t = tx(TransactionType.BUY, 0, 'EUR');
    t.amount = null;
    const result = getSecurityCurrencyGross(t, 'USD', d(1.1));
    expect(result).toBeNull();
  });

  test('GBp/GBP minor-unit regression — security stays in GBP, no 100x inflation', () => {
    // Security currency is GBP. BUY for 1,000 EUR at rate 0.86 (1 EUR = 0.86 GBP).
    // Expected: 860.00 GBP, NOT 86,000 (would be the 100x bug surfacing here).
    const t = tx(TransactionType.BUY, 1000, 'EUR', [
      grossValueUnit(1000, 'EUR', 860, 'GBP', 0.86),
    ]);
    const result = getSecurityCurrencyGross(t, 'GBP');
    expect(result!.toFixed(2)).toBe('860.00');
  });

  // ── Dual-writer acceptance (FOREX type, quovibe-native shape) ──────────
  test('cross-currency BUY with type=FOREX unit returns forex_amount (quovibe-native)', () => {
    // Mirrors transaction.service.ts > buildUnits which emits type='FOREX'
    // (not 'GROSS_VALUE') for cross-currency BUY/SELL/DIVIDEND.
    const t = tx(TransactionType.BUY, 406.79, 'EUR', [
      forexUnit(406.79, 'EUR', 473.01, 'USD', 1.1628),
    ]);
    const result = getSecurityCurrencyGross(t, 'USD');
    expect(result).not.toBeNull();
    expect(result!.toFixed(2)).toBe('473.01');
  });

  test('Test-2026-05-16 fixture — 2 BRK-B BUYs in EUR resolve via FOREX units', () => {
    // The user's reproducer DB: 2 quovibe-native BUYs of BRK-B (USD security)
    // settled in EUR. Each carries a type=FOREX xact_unit (NOT GROSS_VALUE).
    const buy1 = tx(TransactionType.BUY, 406.79, 'EUR', [
      forexUnit(406.79, 'EUR', 473.01, 'USD', 1.1628),
    ]);
    const buy2 = tx(TransactionType.BUY, 404.68, 'EUR', [
      forexUnit(404.68, 'EUR', 475.94, 'USD', 1.1761),
    ]);
    const r1 = getSecurityCurrencyGross(buy1, 'USD');
    const r2 = getSecurityCurrencyGross(buy2, 'USD');
    expect(r1!.toFixed(2)).toBe('473.01');
    expect(r2!.toFixed(2)).toBe('475.94');
    // Expected USD cost basis after both BUYs.
    const total = r1!.plus(r2!);
    expect(total.toFixed(2)).toBe('948.95');
  });
});
