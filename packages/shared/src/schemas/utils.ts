import { z } from 'zod';

export const nonBlankString = (max = 200) =>
  z.string().trim().min(1).max(max);

export const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'ISO 4217 3-letter code');

// 2 letters + 9 alphanumeric + 1 check digit. Format-only (no Luhn).
export const isinString = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z]{2}[A-Z0-9]{9}\d$/,
    'ISIN must be 12 chars: 2 letters + 9 alphanumeric + 1 check digit',
  );

// Tickers can legitimately collide across exchanges (NYSE:AAPL vs LSE:AAPL ADR);
// uniqueness is intentionally NOT enforced (BUG-118).
export const tickerString = z.string().trim().toUpperCase().min(1).max(32);
