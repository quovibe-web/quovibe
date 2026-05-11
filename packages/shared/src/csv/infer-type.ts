// packages/shared/src/csv/infer-type.ts
import { TransactionType } from '../enums';

// Inference rule applied when the CSV `type` column is unmapped at column-map
// time. Account-mode inference table:
//
//   has security + amount > 0 → DIVIDEND
//   has security + amount < 0 → REMOVAL
//   no security  + amount > 0 → DEPOSIT
//   no security  + amount < 0 → REMOVAL
//   amount = 0                → DEPOSIT (fallback)
//
// "Has security" is true when the row carries a non-empty securityName, isin,
// or ticker — any one is enough to identify a security.
//
// Account-mode rules are deliberately preferred over Portfolio-mode rules
// (which would infer SELL/BUY) because they are the more permissive shape
// for typical broker exports that omit the Type column.
export function inferTransactionType(amount: number, hasSecurity: boolean): TransactionType {
  if (amount === 0) return TransactionType.DEPOSIT;
  if (amount > 0) return hasSecurity ? TransactionType.DIVIDEND : TransactionType.DEPOSIT;
  return TransactionType.REMOVAL;
}
