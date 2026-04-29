// packages/shared/src/csv/csv-sniff.ts
//
// Step-1 schema sniff for the CSV import wizard. Runs on the client after the
// server parse returns headers + sample rows. Blocks advancing past Upload
// when the file clearly isn't a transaction CSV (BUG-47) — e.g. non-delimited
// text that parsed as a single column, or a 3-column spreadsheet with no date
// or no numeric column at all. The heuristic is loose on purpose: its only job
// is to catch obviously-wrong input before the user wastes time mapping
// columns. Tight row-level validation still happens at Preview time.
import { parseDate, parseNumber } from './csv-normalizer';

export type SniffReason =
  | 'SINGLE_COLUMN'
  | 'NO_SAMPLE_ROWS'
  | 'NO_DATE_COLUMN'
  | 'NO_AMOUNT_COLUMN';

export interface SniffResult {
  ok: boolean;
  reason: SniffReason | null;
}

export interface SniffOptions {
  dateFormat: string;
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';
}

// At least half the non-empty cells in a column must parse for it to count as
// that column's type. This tolerates the occasional blank or header noise row
// without accepting a column where only one cell happens to look date-ish.
const MATCH_RATIO = 0.5; // native-ok

function columnMatches(
  rows: string[][],
  colIndex: number,
  predicate: (cell: string) => boolean,
): boolean {
  let nonEmpty = 0; // native-ok
  let matched = 0; // native-ok
  for (const row of rows) {
    const cell = (row[colIndex] ?? '').trim();
    if (!cell) continue;
    nonEmpty++; // native-ok
    if (predicate(cell)) matched++; // native-ok
  }
  if (nonEmpty === 0) return false;
  return matched / nonEmpty >= MATCH_RATIO; // native-ok
}

export function sniffLikelyTradeCsv(
  headers: string[],
  sampleRows: string[][],
  opts: SniffOptions,
): SniffResult {
  if (headers.length < 2) { // native-ok
    return { ok: false, reason: 'SINGLE_COLUMN' };
  }
  if (sampleRows.length === 0) { // native-ok
    return { ok: false, reason: 'NO_SAMPLE_ROWS' };
  }

  const colCount = headers.length;
  let hasDateCol = false;
  let hasNumericCol = false;

  for (let c = 0; c < colCount; c++) { // native-ok
    if (!hasDateCol && columnMatches(sampleRows, c, (cell) => parseDate(cell, opts.dateFormat) !== null)) {
      hasDateCol = true;
    }
    if (!hasNumericCol && columnMatches(sampleRows, c, (cell) => parseNumber(cell, opts.decimalSeparator, opts.thousandSeparator) !== null)) {
      hasNumericCol = true;
    }
    if (hasDateCol && hasNumericCol) break;
  }

  if (!hasDateCol) return { ok: false, reason: 'NO_DATE_COLUMN' };
  if (!hasNumericCol) return { ok: false, reason: 'NO_AMOUNT_COLUMN' };
  return { ok: true, reason: null };
}
