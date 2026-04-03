import Decimal from 'decimal.js';

// ppxml2db storage conventions:
//   shares: multiplied by 10^8
//   prices (close/high/low): multiplied by 10^8
//   amounts: multiplied by 10^2 (hecto-units / cents)

/** Converts a JS float to Decimal safely via toPrecision(15) to avoid
 *  floating-point representation artifacts (e.g. 0.1 + 0.2 -> 0.30000000000000004). */
export function safeDecimal(value: number): Decimal {
  return new Decimal(value.toPrecision(15));
}

// --- Read from DB ---

export interface DbTransactionRow {
  shares: number | null;
  amount: number | null;
}

export interface DbPriceRow {
  close: number;
  high?: number | null;
  low?: number | null;
}

export interface ConvertedTransaction {
  shares: Decimal | null;
  amount: Decimal | null;
}

export interface ConvertedPrice {
  close: Decimal;
  high: Decimal | null;
  low: Decimal | null;
}

export function convertTransactionFromDb(row: DbTransactionRow): ConvertedTransaction {
  return {
    shares: row.shares != null ? safeDecimal(row.shares).div(1e8) : null,
    amount: row.amount != null ? safeDecimal(row.amount).div(100) : null,
  };
}

/** Converts a single hecto-unit amount from DB to Decimal. Null/undefined → Decimal(0). */
export function convertAmountFromDb(amount: number | null | undefined): Decimal {
  if (amount == null) return new Decimal(0);
  return safeDecimal(amount).div(100);
}

export function convertPriceFromDb(row: DbPriceRow): ConvertedPrice {
  return {
    close: safeDecimal(row.close).div(1e8),
    high: row.high != null ? safeDecimal(row.high).div(1e8) : null,
    low: row.low != null ? safeDecimal(row.low).div(1e8) : null,
  };
}

// --- Write to DB ---

export interface DbTransactionWrite {
  shares: number | null;
  amount: number | null;
}

export interface DbPriceWrite {
  close: number;
  high?: number;
  low?: number;
}

export function convertTransactionToDb(values: {
  shares?: Decimal | null;
  amount?: Decimal | null;
}): Partial<DbTransactionWrite> {
  const result: Partial<DbTransactionWrite> = {};
  if (values.shares != null) {
    result.shares = Math.round(parseFloat(values.shares.times(1e8).toPrecision(15)));
  }
  if (values.amount != null) {
    result.amount = Math.round(parseFloat(values.amount.times(100).toPrecision(15)));
  }
  return result;
}

export function convertPriceToDb(values: {
  close: Decimal;
  high?: Decimal;
  low?: Decimal;
}): DbPriceWrite {
  const result: DbPriceWrite = {
    close: Math.round(parseFloat(values.close.times(1e8).toPrecision(15))),
  };
  if (values.high != null) {
    result.high = Math.round(parseFloat(values.high.times(1e8).toPrecision(15)));
  }
  if (values.low != null) {
    result.low = Math.round(parseFloat(values.low.times(1e8).toPrecision(15)));
  }
  return result;
}
