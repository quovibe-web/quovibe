// packages/shared/src/csv/csv-normalizer.ts
import { parse, isValid, format } from 'date-fns';
import { TransactionType } from '../enums';
import { transactionTypeAliases } from './type-aliases';
import type { CsvDelimiter } from './csv-types';

/**
 * Parses a raw date string with the given format and returns "YYYY-MM-DD".
 * Returns null if the date is invalid or unparseable.
 */
export function parseDate(raw: string, dateFormat: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // date-fns parse uses format tokens: yyyy, MM, dd
  const parsed = parse(trimmed, dateFormat, new Date(2000, 0, 1));
  if (!isValid(parsed)) return null;

  // Sanity check: month 1-12, day 1-31
  const month = parsed.getMonth() + 1; // native-ok
  const day = parsed.getDate(); // native-ok
  if (month < 1 || month > 12 || day < 1 || day > 31) return null; // native-ok

  return format(parsed, 'yyyy-MM-dd');
}

/**
 * Parses a raw number string with locale-specific separators.
 * Returns null if the string is not a valid number.
 */
export function parseNumber(
  raw: string,
  decimalSeparator: '.' | ',',
  thousandSeparator: '' | '.' | ',' | ' ',
): number | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip thousand separators
  if (thousandSeparator) {
    trimmed = trimmed.split(thousandSeparator).join('');
  }

  // Replace decimal separator with '.'
  if (decimalSeparator === ',') {
    trimmed = trimmed.replaceAll(',', '.');
  }

  const num = Number(trimmed);
  if (Number.isNaN(num) || !Number.isFinite(num)) return null;
  return num;
}

/**
 * Resolves a raw transaction type string (multilingual) to a TransactionType enum value.
 * Returns null if the type is not recognized.
 */
export function normalizeTransactionType(raw: string): TransactionType | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return transactionTypeAliases.get(trimmed) ?? null;
}

/**
 * Auto-detects the most likely delimiter from a header line.
 * Counts occurrences of each candidate delimiter and returns the most frequent.
 */
export function detectDelimiter(headerLine: string): CsvDelimiter {
  const candidates: CsvDelimiter[] = [';', ',', '\t', '|'];
  let bestDelimiter: CsvDelimiter = ',';
  let bestCount = 0; // native-ok

  for (const d of candidates) {
    const count = headerLine.split(d).length - 1; // native-ok
    if (count > bestCount) {
      bestCount = count; // native-ok
      bestDelimiter = d;
    }
  }

  return bestDelimiter;
}
