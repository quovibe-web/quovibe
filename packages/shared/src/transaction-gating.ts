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

// BUY/SELL/DIVIDEND are included for deposit accounts because the API routes them
// to the linked portfolio account when initiated from a deposit account context.
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
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DIVIDEND,
];

const ALLOWED: Record<AccountType, Set<TransactionType>> = {
  [AccountType.SECURITIES]: new Set(SECURITIES_TYPES),
  [AccountType.DEPOSIT]: new Set(DEPOSIT_TYPES),
};

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
