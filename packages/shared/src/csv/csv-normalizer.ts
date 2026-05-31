// packages/shared/src/csv/csv-normalizer.ts
import { parse, isValid, format } from 'date-fns';
import { TransactionType } from '../enums';
import { transactionTypeAliases } from './type-aliases';
import type { CsvDelimiter } from './csv-types';

export interface ParseDateOpts {
  keepTime?: boolean;
}

const TIME_RE = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

/**
 * Parses a raw date string with the given format and returns "YYYY-MM-DD".
 * Returns null if the date is invalid or unparseable.
 *
 * PP CSV exports include an ISO 8601 time component on the Data column
 * (`2020-09-02T15:42:43`, `2020-09-02T15:42`, `2020-09-02T00:00`). By
 * default the time portion is dropped for backward compatibility with
 * the price-import callers. The trade-import path passes
 * `{ keepTime: true }` to preserve the time tail so same-day BUY+SELL
 * rows sort deterministically through the engine.
 */
export function parseDate(
  raw: string,
  dateFormat: string,
  opts: ParseDateOpts = {},
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Split on first T or space to isolate date head and optional time tail.
  const tIdx = trimmed.search(/[T ]/);
  const datePart = tIdx === -1 ? trimmed : trimmed.slice(0, tIdx); // native-ok
  const timeTail = tIdx === -1 ? '' : trimmed.slice(tIdx + 1); // native-ok
  if (!datePart) return null;

  // date-fns parse uses format tokens: yyyy, MM, dd
  const parsed = parse(datePart, dateFormat, new Date(2000, 0, 1));
  if (!isValid(parsed)) return null;

  // Sanity check: month 1-12, day 1-31
  const month = parsed.getMonth() + 1; // native-ok
  const day = parsed.getDate(); // native-ok
  if (month < 1 || month > 12 || day < 1 || day > 31) return null; // native-ok

  const dayIso = format(parsed, 'yyyy-MM-dd');

  if (opts.keepTime && timeTail) {
    const timeIso = parseTimeStr(timeTail);
    if (timeIso) return `${dayIso}T${timeIso}`;
    // malformed time tail → fall through to day-only
  }

  return dayIso;
}

/**
 * Takes a day-granular ISO date (`YYYY-MM-DD`) and a separate time cell
 * (`HH:mm` or `HH:mm:ss`) and returns an ISO timestamp `YYYY-MM-DDTHH:mm:ss`.
 * Returns the bare date when `time` is empty, whitespace-only, or malformed.
 */
export function combineDateAndTime(dayIso: string, time: string): string {
  const trimmed = time.trim();
  if (!trimmed) return dayIso;
  const timeIso = parseTimeStr(trimmed);
  return timeIso ? `${dayIso}T${timeIso}` : dayIso;
}

/** Internal: parse `HH:mm[:ss]` → `HH:mm:ss` with zero-padding, or null. */
function parseTimeStr(raw: string): string | null {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  const hh = parseInt(m[1]!, 10); // native-ok
  const mm = parseInt(m[2]!, 10); // native-ok
  const ss = m[3] != null ? parseInt(m[3], 10) : 0; // native-ok
  if (hh > 23 || mm > 59 || ss > 59) return null; // native-ok
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
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

/**
 * Like parseNumber, but accepts a trailing K/M/B suffix (case-insensitive)
 * and multiplies the parsed value by 1e3 / 1e6 / 1e9 respectively.
 *
 * INTENTIONAL CONSTRAINT: this helper is reserved for the price-flow
 * `volume` column only. The trade flow MUST keep using `parseNumber`,
 * because the same suffix in a `shares` or `amount` column would silently
 * 1000× the cost basis.
 */
export function parseNumberWithSuffix(
  raw: string,
  decimalSeparator: '.' | ',',
  thousandSeparator: '' | '.' | ',' | ' ',
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let multiplier = 1; // native-ok
  let body = trimmed;
  const lastChar = body[body.length - 1]?.toLowerCase();
  if (lastChar === 'k') {
    multiplier = 1_000; // native-ok
    body = body.slice(0, -1);
  } else if (lastChar === 'm') {
    multiplier = 1_000_000; // native-ok
    body = body.slice(0, -1);
  } else if (lastChar === 'b') {
    multiplier = 1_000_000_000; // native-ok
    body = body.slice(0, -1);
  }

  const base = parseNumber(body, decimalSeparator, thousandSeparator);
  if (base == null) return null;
  return base * multiplier; // native-ok — multiplier is exact integer
}
