import Decimal from 'decimal.js';
import { TransactionWithUnits, TransactionType } from '@quovibe/shared';

function toDecimal(val: number): Decimal {
  return new Decimal(val.toPrecision(15));
}

/**
 * Transaction types where ppxml2db stores amount as total outflow (gross + fees + taxes).
 * For these types, gross = amount - fees - taxes.
 *
 * All other types store amount as net inflow (gross - fees - taxes),
 * so gross = amount + fees + taxes.
 */
const OUTFLOW_TYPES: ReadonlySet<string> = new Set([
  TransactionType.BUY,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.INTEREST_CHARGE,
  TransactionType.FEES,
  TransactionType.TAXES,
]);

/**
 * Returns the gross amount (shares × price) for a transaction.
 *
 * ppxml2db convention: xact.amount is the net settlement value, not gross.
 * Gross is reconstructed from amount ± fees ± taxes based on direction:
 *   Outflow (BUY etc.): amount = gross + fees + taxes  → gross = amount - fees - taxes
 *   Inflow  (SELL etc.): amount = gross - fees - taxes  → gross = amount + fees + taxes
 */
export function getGrossAmount(tx: TransactionWithUnits): Decimal {
  const amount = toDecimal(tx.amount ?? 0);
  const fees = getFees(tx);
  const taxes = getTaxes(tx);
  if (fees.isZero() && taxes.isZero()) return amount;

  return OUTFLOW_TYPES.has(tx.type)
    ? amount.minus(fees).minus(taxes)
    : amount.plus(fees).plus(taxes);
}

export function getFees(tx: TransactionWithUnits): Decimal {
  return tx.units
    .filter((u) => u.type === 'FEE')
    .reduce((sum, u) => sum.plus(toDecimal(u.amount)), new Decimal(0));
}

export function getTaxes(tx: TransactionWithUnits): Decimal {
  return tx.units
    .filter((u) => u.type === 'TAX')
    .reduce((sum, u) => sum.plus(toDecimal(u.amount)), new Decimal(0));
}

export function getNetAmount(tx: TransactionWithUnits): Decimal {
  const gross = getGrossAmount(tx);
  const fees = getFees(tx);
  const taxes = getTaxes(tx);
  // Net = total cash impact:
  //   Outflow (BUY etc.): net = gross + fees + taxes
  //   Inflow  (SELL etc.): net = gross - fees - taxes
  return OUTFLOW_TYPES.has(tx.type)
    ? gross.plus(fees).plus(taxes)
    : gross.minus(fees).minus(taxes);
}

/**
 * Returns the gross transaction amount in the security's native currency.
 *
 * Resolution priority (single source of truth — see
 * docs/architecture/multi-currency.md):
 *
 *   1. Same-currency trade (tx.currencyCode === securityCurrency) →
 *      returns getGrossAmount(tx) unchanged.
 *   2. Any unit carrying fxCurrencyCode === securityCurrency and a
 *      non-null fxAmount → returns fxAmount as a Decimal. Read-tolerant
 *      across BOTH writers: ppxml2db emits PP's `type="GROSS_VALUE"`
 *      verbatim from XML; transaction.service.ts emits `type="FOREX"`
 *      for the same per-trade FX decoration. The shape (amount=deposit,
 *      forex_amount=security, exchangeRate=deposit-per-security) is
 *      identical — discriminate by payload, not label.
 *   3. fallbackRate provided (deposit→security multiplicative) → returns
 *      getGrossAmount(tx) × fallbackRate. Used by the service-layer
 *      backfill path that consults vf_exchange_rate when no FX-unit
 *      exists (older PP-XML imports pre-BUG-fix).
 *   4. Unresolvable → null.
 *
 * Callers must treat null as "cannot compute per-security perf for this
 * transaction" and surface the row to the user as needing a manual rate.
 */
export function getSecurityCurrencyGross(
  tx: TransactionWithUnits,
  securityCurrency: string,
  fallbackRate?: Decimal | null,
): Decimal | null {
  if (tx.amount == null) return null;

  if (tx.currencyCode === securityCurrency) {
    return getGrossAmount(tx);
  }

  const fxUnit = tx.units.find(
    (u) =>
      (u.type === 'GROSS_VALUE' || u.type === 'FOREX') &&
      u.fxCurrencyCode === securityCurrency &&
      u.fxAmount != null,
  );
  if (fxUnit && fxUnit.fxAmount != null) {
    return toDecimal(fxUnit.fxAmount);
  }

  if (fallbackRate && !fallbackRate.isZero()) {
    return getGrossAmount(tx).times(fallbackRate);
  }

  return null;
}
