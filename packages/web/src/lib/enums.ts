// Local copies of shared enums for Vite/Rollup compatibility.
// Values must stay in sync with packages/shared/src/enums.ts.

export enum TransactionType {
  BUY = 'BUY',
  SELL = 'SELL',
  DELIVERY_INBOUND = 'DELIVERY_INBOUND',
  DELIVERY_OUTBOUND = 'DELIVERY_OUTBOUND',
  DEPOSIT = 'DEPOSIT',
  REMOVAL = 'REMOVAL',
  DIVIDEND = 'DIVIDEND',
  INTEREST = 'INTEREST',
  INTEREST_CHARGE = 'INTEREST_CHARGE',
  FEES = 'FEES',
  FEES_REFUND = 'FEES_REFUND',
  TAXES = 'TAXES',
  TAX_REFUND = 'TAX_REFUND',
  SECURITY_TRANSFER = 'SECURITY_TRANSFER',
  TRANSFER_BETWEEN_ACCOUNTS = 'TRANSFER_BETWEEN_ACCOUNTS',
}

export enum CostMethod {
  FIFO = 'FIFO',
  MOVING_AVERAGE = 'MOVING_AVERAGE',
}

export enum AccountType {
  DEPOSIT = 'DEPOSIT',
  SECURITIES = 'SECURITIES',
}

export enum SecurityEventType {
  STOCK_SPLIT = 'STOCK_SPLIT',
  EVENT = 'EVENT',
  NOTE = 'NOTE',
}

const SECURITIES_TYPES: TransactionType[] = [
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

const DEPOSIT_TYPES: TransactionType[] = [
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

export function getAvailableTransactionTypes(accountType: AccountType): TransactionType[] {
  return accountType === AccountType.SECURITIES ? SECURITIES_TYPES : DEPOSIT_TYPES;
}

export function isTransactionTypeAllowed(accountType: AccountType, type: TransactionType): boolean {
  return ALLOWED[accountType]?.has(type) ?? false;
}
