export const TransactionType = {
  BUY: 'BUY',
  SELL: 'SELL',
  DELIVERY_INBOUND: 'DELIVERY_INBOUND',
  DELIVERY_OUTBOUND: 'DELIVERY_OUTBOUND',
  DEPOSIT: 'DEPOSIT',
  REMOVAL: 'REMOVAL',
  DIVIDEND: 'DIVIDEND',
  INTEREST: 'INTEREST',
  INTEREST_CHARGE: 'INTEREST_CHARGE',
  FEES: 'FEES',
  FEES_REFUND: 'FEES_REFUND',
  TAXES: 'TAXES',
  TAX_REFUND: 'TAX_REFUND',
  SECURITY_TRANSFER: 'SECURITY_TRANSFER',
  TRANSFER_BETWEEN_ACCOUNTS: 'TRANSFER_BETWEEN_ACCOUNTS',
} as const;
export type TransactionType = typeof TransactionType[keyof typeof TransactionType];

export const CostMethod = {
  FIFO: 'FIFO',
  MOVING_AVERAGE: 'MOVING_AVERAGE',
} as const;
export type CostMethod = typeof CostMethod[keyof typeof CostMethod];

export const AccountType = {
  DEPOSIT: 'DEPOSIT',
  SECURITIES: 'SECURITIES',
} as const;
export type AccountType = typeof AccountType[keyof typeof AccountType];

export const SecurityEventType = {
  STOCK_SPLIT: 'STOCK_SPLIT',
  EVENT: 'EVENT',
  NOTE: 'NOTE',
} as const;
export type SecurityEventType = typeof SecurityEventType[keyof typeof SecurityEventType];

/**
 * Normalized instrument type for UI display (badges, filters).
 * Maps from Yahoo Finance quoteType values.
 */
export const InstrumentType = {
  EQUITY: 'EQUITY',
  ETF: 'ETF',
  BOND: 'BOND',
  CRYPTO: 'CRYPTO',
  COMMODITY: 'COMMODITY',
  FUND: 'FUND',
  INDEX: 'INDEX',
  CURRENCY: 'CURRENCY',
  UNKNOWN: 'UNKNOWN',
} as const;
export type InstrumentType = typeof InstrumentType[keyof typeof InstrumentType];
