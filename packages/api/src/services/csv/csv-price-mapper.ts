import Decimal from 'decimal.js';
import type { NormalizedPriceRow, RowError } from '@quovibe/shared';

export interface PriceInsert {
  securityId: string;
  date: string;
  close: number;      // × 10^8
  high?: number;
  low?: number;
  volume?: number;
}

export interface PriceMapResult {
  prices: PriceInsert[];
  errors: RowError[];
}

function toPriceDb(value: number): number {
  return Math.round(parseFloat(new Decimal(value).times(1e8).toPrecision(15)));
}

export function mapPriceRows(rows: NormalizedPriceRow[], securityId: string): PriceMapResult {
  const prices: PriceInsert[] = [];
  const errors: RowError[] = [];

  for (const row of rows) {
    if (row.close <= 0) {
      errors.push({
        row: row.rowNumber,
        column: 'close',
        value: String(row.close),
        code: 'INVALID_PRICE',
        message: 'csvImport.errors.invalidPrice',
      });
      continue;
    }

    const insert: PriceInsert = {
      securityId,
      date: row.date,
      close: toPriceDb(row.close),
    };

    if (row.high != null) insert.high = toPriceDb(row.high);
    if (row.low != null) insert.low = toPriceDb(row.low);
    if (row.volume != null) insert.volume = row.volume;

    prices.push(insert);
  }

  return { prices, errors };
}
