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
