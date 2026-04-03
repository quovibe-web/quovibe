import Decimal from 'decimal.js';

/**
 * A single line in a Statement of Assets snapshot.
 * Represents the state of one security or cash account at a given date.
 */
export interface StatementEntry {
  date: string;
  /** Security UUID (present for equity/fund positions) */
  securityId?: string;
  /** Account UUID (present for cash/deposit account entries) */
  accountId?: string;
  /** Name for display */
  name?: string;
  /** Number of shares held (securities only) */
  shares?: Decimal;
  /** Price per share at the snapshot date (securities only) */
  pricePerShare?: Decimal;
  /** Total market value = shares × price (or cash balance for deposit accounts) */
  marketValue: Decimal;
  /** Purchase value in the context of a reporting period */
  purchaseValue?: Decimal;
  /** Unrealized gain/loss relative to purchase value */
  unrealizedGain?: Decimal;
  /** ISO currency code */
  currency?: string;
}

/**
 * Aggregated Statement of Assets for a portfolio at a given date.
 */
export interface StatementOfAssets {
  date: string;
  securities: StatementEntry[];
  depositAccounts: StatementEntry[];
  totals: {
    marketValue: Decimal;
    purchaseValue: Decimal;
    unrealizedGain: Decimal;
  };
}
