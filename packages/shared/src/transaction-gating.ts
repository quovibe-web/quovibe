import { AccountType, TransactionType } from './enums';

const SECURITIES_TYPES: readonly TransactionType[] = [
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DIVIDEND,
  TransactionType.FEES,
  TransactionType.FEES_REFUND,
  TransactionType.TAXES,
  TransactionType.TAX_REFUND,
  TransactionType.SECURITY_TRANSFER,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DELIVERY_OUTBOUND,
];

// DIVIDEND is included for deposit accounts because the cash-side row of a
// dividend legitimately lives on a deposit (Group B cash-only routing). BUY/SELL
// are NOT included: they require a portfolio (`type='portfolio'`) source — the
// service auto-routes a portfolio source to its `referenceAccount` cash side
// (CASH_ONLY_ROUTED_TYPES), but never the inverse. Allowing BUY/SELL on a
// deposit-typed `accountId` was the root of BUG-107.
const DEPOSIT_TYPES: readonly TransactionType[] = [
  TransactionType.DEPOSIT,
  TransactionType.REMOVAL,
  TransactionType.INTEREST,
  TransactionType.INTEREST_CHARGE,
  TransactionType.FEES,
  TransactionType.FEES_REFUND,
  TransactionType.TAXES,
  TransactionType.TAX_REFUND,
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
  TransactionType.DIVIDEND,
];

const ALLOWED: Record<AccountType, Set<TransactionType>> = {
  [AccountType.SECURITIES]: new Set(SECURITIES_TYPES),
  [AccountType.DEPOSIT]: new Set(DEPOSIT_TYPES),
};

// Types whose `amount` is derived from shares × quote price and must be > 0.
// PP convention (docs/pp-reference/transfer.md) — used by the shared Zod schema
// guardrail and by the web client's preparePayload derivation.
export const PRICED_SHARE_TYPES: ReadonlySet<TransactionType> = new Set([
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DELIVERY_OUTBOUND,
  TransactionType.SECURITY_TRANSFER,
]);

// Types for which the API service layer auto-routes a portfolio (securities)
// `accountId` to its linked deposit (`referenceAccount`). The route-handler 422
// guard and the service's `resolveAccountTarget` must stay aligned on this set:
// a transaction whose `accountId` is a portfolio is only acceptable when the
// type is in this set — anything else (e.g. TRANSFER_BETWEEN_ACCOUNTS) would
// pin the portfolio as the cash holder, which is a data-integrity hole.
export const CASH_ONLY_ROUTED_TYPES: ReadonlySet<TransactionType> = new Set([
  TransactionType.DEPOSIT,
  TransactionType.REMOVAL,
  TransactionType.DIVIDEND,
  TransactionType.INTEREST,
  TransactionType.INTEREST_CHARGE,
  TransactionType.FEES,
  TransactionType.FEES_REFUND,
  TransactionType.TAXES,
  TransactionType.TAX_REFUND,
]);

// Types that REQUIRE a `securityId` on the wire payload. PRICED_SHARE_TYPES carry
// shares of a specific instrument; DIVIDEND is cash-only at the routing layer but
// per ppxml2db convention its cash-side row mirrors the dividend's security UUID
// (D4 fix in `.claude/rules/double-entry.md`), so the wire payload must specify it.
// Closes BUG-106 at the Zod boundary.
export const SECURITY_REQUIRED_TYPES: ReadonlySet<TransactionType> = new Set([
  ...PRICED_SHARE_TYPES,
  TransactionType.DIVIDEND,
]);

// Types that REQUIRE a strictly-positive `amount` on the wire payload. Cash-only
// types and BUY/SELL/TRANSFER_BETWEEN_ACCOUNTS all carry a real cashflow.
// Excluded — and therefore allowed to use `amount = 0` per ppxml2db share-only
// convention — are SECURITY_TRANSFER, DELIVERY_INBOUND, DELIVERY_OUTBOUND.
// Closes BUG-113 at the Zod boundary.
export const AMOUNT_REQUIRED_TYPES: ReadonlySet<TransactionType> = new Set([
  ...CASH_ONLY_ROUTED_TYPES,
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
]);

// Types where a cross-currency leg makes `fxRate` mandatory. Enforced at the
// route layer (`enforceCrossCurrencyFxRate` in `routes/transactions.ts`) because
// resolving the relevant currencies requires DB lookups against `account` and
// `security`, which `@quovibe/shared` cannot perform. Closes BUG-111 + BUG-112.
export const CROSS_CURRENCY_FX_TYPES: ReadonlySet<TransactionType> = new Set([
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
]);

/**
 * Returns the list of transaction types available for the given account type.
 *
 * @param accountType - The account type (`SECURITIES` or `DEPOSIT`).
 * @returns Readonly array of allowed `TransactionType` values for that account.
 */
export function getAvailableTransactionTypes(accountType: AccountType): readonly TransactionType[] {
  return accountType === AccountType.SECURITIES ? SECURITIES_TYPES : DEPOSIT_TYPES;
}

/**
 * Returns whether a transaction type is permitted for the given account type.
 *
 * @param accountType - The account type to check against.
 * @param type - The transaction type to test.
 * @returns `true` if the type is allowed, `false` otherwise.
 */
export function isTransactionTypeAllowed(accountType: AccountType, type: TransactionType): boolean {
  return ALLOWED[accountType]?.has(type) ?? false;
}
