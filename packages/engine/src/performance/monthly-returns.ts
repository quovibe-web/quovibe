import Decimal from 'decimal.js';

export interface MonthlyReturnEntry {
  year: number;
  month: number; // 1–12
  value: Decimal;
}

export interface YearlyReturnEntry {
  year: number;
  value: Decimal;
}

export interface MonthlyReturnsResult {
  monthly: MonthlyReturnEntry[];
  yearly: YearlyReturnEntry[];
}

/**
 * Aggregates daily TTWROR returns into monthly and yearly buckets.
 *
 * Compound daily factors within each month:
 *   monthReturn = product(1 + r_i) - 1
 *   yearReturn  = product(1 + monthReturn_j) - 1
 */
export function aggregateMonthlyReturns(
  dailyReturns: Array<{ date: string; r: Decimal }>,
): MonthlyReturnsResult {
  if (dailyReturns.length === 0) {
    return { monthly: [], yearly: [] };
  }

  // Group products by year-month
  const monthProducts = new Map<string, Decimal>(); // key: "YYYY-MM"
  const ONE = new Decimal(1);

  for (const { date, r } of dailyReturns) {
    const key = date.slice(0, 7); // "YYYY-MM"
    const current = monthProducts.get(key) ?? ONE;
    monthProducts.set(key, current.times(ONE.plus(r)));
  }

  // Build monthly entries, group year products
  const monthly: MonthlyReturnEntry[] = [];
  const yearProducts = new Map<number, Decimal>();

  for (const [key, product] of monthProducts) {
    const year = parseInt(key.slice(0, 4), 10);
    const month = parseInt(key.slice(5, 7), 10);
    const value = product.minus(ONE);
    monthly.push({ year, month, value });

    const currentYear = yearProducts.get(year) ?? ONE;
    yearProducts.set(year, currentYear.times(product));
  }

  monthly.sort((a, b) => a.year - b.year || a.month - b.month);

  const yearly: YearlyReturnEntry[] = [];
  for (const [year, product] of yearProducts) {
    yearly.push({ year, value: product.minus(ONE) });
  }
  yearly.sort((a, b) => a.year - b.year);

  return { monthly, yearly };
}
