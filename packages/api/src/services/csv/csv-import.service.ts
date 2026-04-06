// packages/api/src/services/csv/csv-import.service.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  parseDate, parseNumber, normalizeTransactionType,
  type NormalizedTradeRow, type NormalizedPriceRow,
  type RowError, type CsvParseResult, type TradePreviewResult,
  type TradeExecuteResult, type PriceExecuteResult, type PreviewRow,
  type UnmatchedSecurity, type CsvDelimiter,
} from '@quovibe/shared';
import { parseCsvFile, parseCsvRows } from './csv-reader';
import { mapTradeRows, type TradeMapperContext, type XactInsert, type CrossEntryInsert } from './csv-trade-mapper';
import { mapPriceRows, type PriceInsert } from './csv-price-mapper';

// ─── Temp file management ─────────────────────────

const TEMP_DIR = path.join(os.tmpdir(), 'quovibe-csv');
const LOCK_PATH = path.join(os.tmpdir(), 'quovibe-csv-import.lock');
const LOCK_STALE_MS = 5 * 60 * 1000; // native-ok
const TEMP_MAX_AGE_MS = 60 * 60 * 1000; // native-ok

function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

export function saveTempFile(buffer: Buffer, originalName: string): string {
  ensureTempDir();
  const id = uuidv4();
  const ext = path.extname(originalName);
  const filePath = path.join(TEMP_DIR, `${id}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return id;
}

export function getTempFilePath(tempFileId: string): string | null {
  ensureTempDir();
  const files = fs.readdirSync(TEMP_DIR);
  const match = files.find((f) => f.startsWith(tempFileId));
  if (!match) return null;
  return path.join(TEMP_DIR, match);
}

export function cleanupTempFiles(): void {
  if (!fs.existsSync(TEMP_DIR)) return;
  const now = Date.now(); // native-ok
  for (const file of fs.readdirSync(TEMP_DIR)) {
    const filePath = path.join(TEMP_DIR, file);
    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs > TEMP_MAX_AGE_MS) { // native-ok
      fs.unlinkSync(filePath);
    }
  }
}

// ─── Lock management ──────────────────────────────

export function isImportLocked(): boolean {
  if (!fs.existsSync(LOCK_PATH)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8')) as { pid: number; ts: number };
    if (Date.now() - data.ts > LOCK_STALE_MS) { // native-ok
      fs.unlinkSync(LOCK_PATH);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): void {
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, ts: Date.now() }));
}

function releaseLock(): void {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

// ─── Parse (Step 1) ───────────────────────────────

export async function parseCsv(
  tempFileId: string,
  opts: { delimiter?: CsvDelimiter; skipLines?: number },
): Promise<CsvParseResult> {
  const filePath = getTempFilePath(tempFileId);
  if (!filePath) throw new CsvImportError('TEMP_FILE_EXPIRED', 'Temp file not found');

  const result = await parseCsvFile(filePath, opts);
  return {
    tempFileId,
    headers: result.headers,
    sampleRows: result.sampleRows,
    detectedDelimiter: result.detectedDelimiter,
    totalRows: result.totalRows,
  };
}

// ─── Trade Preview (Step 2-3) ─────────────────────

interface TradePreviewInput {
  tempFileId: string;
  delimiter: CsvDelimiter;
  columnMapping: Record<string, number>;
  dateFormat: string;
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';
  targetPortfolioId: string;
}

export async function previewTradeImport(
  sqlite: BetterSqlite3.Database,
  input: TradePreviewInput,
): Promise<TradePreviewResult> {
  const filePath = getTempFilePath(input.tempFileId);
  if (!filePath) throw new CsvImportError('TEMP_FILE_EXPIRED', 'Temp file not found');

  // Resolve portfolio -> deposit account
  const acctRow = sqlite.prepare(
    'SELECT uuid, type, currency, referenceAccount FROM account WHERE uuid = ?',
  ).get(input.targetPortfolioId) as { uuid: string; type: string; currency: string | null; referenceAccount: string | null } | undefined;

  if (!acctRow || acctRow.type !== 'portfolio') {
    throw new CsvImportError('INVALID_PORTFOLIO', 'Target must be a portfolio account');
  }
  if (!acctRow.referenceAccount) {
    throw new CsvImportError('NO_REFERENCE_ACCOUNT', 'Portfolio has no linked deposit account');
  }

  const depositRow = sqlite.prepare('SELECT uuid, currency FROM account WHERE uuid = ?')
    .get(acctRow.referenceAccount) as { uuid: string; currency: string | null } | undefined;
  const portfolioCurrency = depositRow?.currency ?? 'EUR';

  // Read and normalize all rows
  const normalizedRows: NormalizedTradeRow[] = [];
  const rowErrors: RowError[] = [];

  let rowNum = 1; // native-ok
  for await (const fields of parseCsvRows(filePath, { delimiter: input.delimiter, skipLines: 0 })) {
    const dateIdx = input.columnMapping['date'];
    const typeIdx = input.columnMapping['type'];
    const securityIdx = input.columnMapping['security'];
    const amountIdx = input.columnMapping['amount'];
    const sharesIdx = input.columnMapping['shares'];
    const feesIdx = input.columnMapping['fees'];
    const taxesIdx = input.columnMapping['taxes'];
    const currencyIdx = input.columnMapping['currency'];
    const noteIdx = input.columnMapping['note'];
    const isinIdx = input.columnMapping['isin'];
    const tickerIdx = input.columnMapping['ticker'];
    const crossAccountIdx = input.columnMapping['crossAccount'];

    // Parse date
    const rawDate = dateIdx != null ? fields[dateIdx] ?? '' : '';
    const date = parseDate(rawDate, input.dateFormat);
    if (!date) {
      rowErrors.push({ row: rowNum, column: 'date', value: rawDate, code: 'INVALID_DATE', message: 'csvImport.errors.invalidDate' });
      rowNum++; // native-ok
      continue;
    }

    // Parse type
    const rawType = typeIdx != null ? fields[typeIdx] ?? '' : '';
    const txType = normalizeTransactionType(rawType);
    if (!txType) {
      rowErrors.push({ row: rowNum, column: 'type', value: rawType, code: 'UNKNOWN_TYPE', message: 'csvImport.errors.unknownType' });
      rowNum++; // native-ok
      continue;
    }

    // Parse amount
    const rawAmount = amountIdx != null ? fields[amountIdx] ?? '' : '';
    const amount = parseNumber(rawAmount, input.decimalSeparator, input.thousandSeparator);
    if (amount == null) {
      rowErrors.push({ row: rowNum, column: 'amount', value: rawAmount, code: 'INVALID_NUMBER', message: 'csvImport.errors.invalidNumber' });
      rowNum++; // native-ok
      continue;
    }

    const normalized: NormalizedTradeRow = {
      rowNumber: rowNum,
      date,
      type: txType,
      securityName: securityIdx != null ? (fields[securityIdx] ?? '').trim() : '',
      isin: isinIdx != null ? (fields[isinIdx] ?? '').trim() || undefined : undefined,
      ticker: tickerIdx != null ? (fields[tickerIdx] ?? '').trim() || undefined : undefined,
      amount,
    };

    // Optional fields
    if (sharesIdx != null) {
      const shares = parseNumber(fields[sharesIdx] ?? '', input.decimalSeparator, input.thousandSeparator);
      if (shares != null) normalized.shares = shares;
    }
    if (feesIdx != null) {
      const fees = parseNumber(fields[feesIdx] ?? '', input.decimalSeparator, input.thousandSeparator);
      if (fees != null) normalized.fees = fees;
    }
    if (taxesIdx != null) {
      const taxes = parseNumber(fields[taxesIdx] ?? '', input.decimalSeparator, input.thousandSeparator);
      if (taxes != null) normalized.taxes = taxes;
    }
    if (currencyIdx != null) {
      const cur = (fields[currencyIdx] ?? '').trim();
      if (cur) normalized.currency = cur;
    }
    if (noteIdx != null) {
      const note = (fields[noteIdx] ?? '').trim();
      if (note) normalized.note = note;
    }
    if (crossAccountIdx != null) {
      const crossAccount = (fields[crossAccountIdx] ?? '').trim();
      if (crossAccount) normalized.crossAccountId = crossAccount;
    }

    normalizedRows.push(normalized);
    rowNum++; // native-ok
  }

  // Extract unique securities for matching
  const uniqueSecurities = new Map<string, { isin?: string; ticker?: string }>();
  for (const row of normalizedRows) {
    if (row.securityName && !uniqueSecurities.has(row.securityName)) {
      uniqueSecurities.set(row.securityName, { isin: row.isin, ticker: row.ticker });
    }
  }

  // Auto-match securities
  const securityMap = new Map<string, string>();
  const unmatchedSecurities: UnmatchedSecurity[] = [];

  for (const [csvName, info] of uniqueSecurities) {
    let match: { uuid: string; name: string; isin: string } | undefined;

    // Try ISIN exact match
    if (info.isin) {
      match = sqlite.prepare('SELECT uuid, name, isin FROM security WHERE isin = ? LIMIT 1')
        .get(info.isin) as typeof match;
    }

    // Try ticker exact match
    if (!match && info.ticker) {
      match = sqlite.prepare('SELECT uuid, name, isin FROM security WHERE tickerSymbol = ? LIMIT 1')
        .get(info.ticker) as typeof match;
    }

    // Try name (case-insensitive contains)
    if (!match) {
      match = sqlite.prepare("SELECT uuid, name, isin FROM security WHERE LOWER(name) LIKE '%' || LOWER(?) || '%' LIMIT 1")
        .get(csvName) as typeof match;
    }

    if (match) {
      securityMap.set(csvName, match.uuid);
      unmatchedSecurities.push({
        csvName,
        csvIsin: info.isin,
        csvTicker: info.ticker,
        suggestedMatch: { id: match.uuid, name: match.name, isin: match.isin },
      });
    } else {
      unmatchedSecurities.push({ csvName, csvIsin: info.isin, csvTicker: info.ticker });
    }
  }

  // Map to transactions for preview
  const ctx: TradeMapperContext = {
    portfolioId: input.targetPortfolioId,
    depositAccountId: acctRow.referenceAccount,
    portfolioCurrency,
    securityMap,
  };

  const mapped = mapTradeRows(normalizedRows, ctx);

  // Build preview rows
  const previewRows: PreviewRow[] = normalizedRows.map((row) => ({
    rowNumber: row.rowNumber,
    date: row.date,
    type: row.type,
    securityName: row.securityName,
    shares: row.shares,
    amount: row.amount,
    fees: row.fees,
    taxes: row.taxes,
    currency: row.currency,
    note: row.note,
    error: mapped.errors.find((e) => e.row === row.rowNumber),
  }));

  // Summary
  const byType: Record<string, number> = {};
  for (const row of normalizedRows) {
    byType[row.type] = (byType[row.type] ?? 0) + 1; // native-ok
  }

  return {
    rows: previewRows,
    unmatchedSecurities,
    errors: [...rowErrors, ...mapped.errors],
    summary: {
      total: normalizedRows.length + rowErrors.length, // native-ok
      valid: normalizedRows.length - mapped.errors.length, // native-ok
      errors: rowErrors.length + mapped.errors.length, // native-ok
      byType,
    },
  };
}

// ─── Trade Execute (Step 4) ───────────────────────

interface TradeExecuteInput {
  tempFileId: string;
  config: {
    delimiter: CsvDelimiter;
    columnMapping: Record<string, number>;
    dateFormat: string;
    decimalSeparator: '.' | ',';
    thousandSeparator: '' | '.' | ',' | ' ';
  };
  targetPortfolioId: string;
  securityMapping: Record<string, string>;       // csvName → securityId
  newSecurities: Array<{ name: string; isin?: string; ticker?: string; currency: string }>;
  excludedRows: number[];
}

export async function executeTradeImport(
  sqlite: BetterSqlite3.Database,
  input: TradeExecuteInput,
): Promise<TradeExecuteResult> {
  if (isImportLocked()) throw new CsvImportError('IMPORT_IN_PROGRESS', 'Another import is running');

  const filePath = getTempFilePath(input.tempFileId);
  if (!filePath) throw new CsvImportError('TEMP_FILE_EXPIRED', 'Temp file not found');

  acquireLock();
  try {
    // Resolve portfolio -> deposit
    const acctRow = sqlite.prepare(
      'SELECT uuid, type, currency, referenceAccount FROM account WHERE uuid = ?',
    ).get(input.targetPortfolioId) as { uuid: string; type: string; currency: string | null; referenceAccount: string | null };

    const depositRow = sqlite.prepare('SELECT uuid, currency FROM account WHERE uuid = ?')
      .get(acctRow.referenceAccount!) as { uuid: string; currency: string | null };
    const portfolioCurrency = depositRow?.currency ?? 'EUR';

    // Create new securities first
    let createdSecurities = 0; // native-ok
    const securityMap = new Map(Object.entries(input.securityMapping));

    for (const sec of input.newSecurities) {
      const secId = uuidv4();
      sqlite.prepare(
        'INSERT INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(secId, sec.name, sec.isin ?? null, sec.ticker ?? null, sec.currency, new Date().toISOString());
      securityMap.set(sec.name, secId);
      createdSecurities++; // native-ok
    }

    // Re-parse and normalize (same as preview)
    const normalizedRows: NormalizedTradeRow[] = [];
    const excludedSet = new Set(input.excludedRows);

    let rowNum = 1; // native-ok
    for await (const fields of parseCsvRows(filePath, { delimiter: input.config.delimiter, skipLines: 0 })) {
      if (excludedSet.has(rowNum)) {
        rowNum++; // native-ok
        continue;
      }

      const date = parseDate(
        fields[input.config.columnMapping['date']] ?? '',
        input.config.dateFormat,
      );
      const txType = normalizeTransactionType(fields[input.config.columnMapping['type']] ?? '');
      const amount = parseNumber(
        fields[input.config.columnMapping['amount']] ?? '',
        input.config.decimalSeparator,
        input.config.thousandSeparator,
      );

      if (!date || !txType || amount == null) {
        rowNum++; // native-ok
        continue;
      }

      const row: NormalizedTradeRow = {
        rowNumber: rowNum,
        date,
        type: txType,
        securityName: (fields[input.config.columnMapping['security']] ?? '').trim(),
        amount,
      };

      // Optional fields
      const sharesIdx = input.config.columnMapping['shares'];
      if (sharesIdx != null) {
        const shares = parseNumber(fields[sharesIdx] ?? '', input.config.decimalSeparator, input.config.thousandSeparator);
        if (shares != null) row.shares = shares;
      }
      const feesIdx = input.config.columnMapping['fees'];
      if (feesIdx != null) {
        const fees = parseNumber(fields[feesIdx] ?? '', input.config.decimalSeparator, input.config.thousandSeparator);
        if (fees != null) row.fees = fees;
      }
      const taxesIdx = input.config.columnMapping['taxes'];
      if (taxesIdx != null) {
        const taxes = parseNumber(fields[taxesIdx] ?? '', input.config.decimalSeparator, input.config.thousandSeparator);
        if (taxes != null) row.taxes = taxes;
      }
      const currencyIdx = input.config.columnMapping['currency'];
      if (currencyIdx != null) {
        const cur = (fields[currencyIdx] ?? '').trim();
        if (cur) row.currency = cur;
      }
      const noteIdx = input.config.columnMapping['note'];
      if (noteIdx != null) {
        const note = (fields[noteIdx] ?? '').trim();
        if (note) row.note = note;
      }
      const crossAccountIdx = input.config.columnMapping['crossAccount'];
      if (crossAccountIdx != null) {
        const crossAccount = (fields[crossAccountIdx] ?? '').trim();
        if (crossAccount) row.crossAccountId = crossAccount;
      }

      normalizedRows.push(row);
      rowNum++; // native-ok
    }

    // Map
    const ctx: TradeMapperContext = {
      portfolioId: input.targetPortfolioId,
      depositAccountId: acctRow.referenceAccount!,
      portfolioCurrency,
      securityMap,
    };

    const mapped = mapTradeRows(normalizedRows, ctx);

    // Insert all in a single SQLite transaction
    const doInsert = sqlite.transaction((txns: XactInsert[], entries: CrossEntryInsert[]) => {
      const insertXact = sqlite.prepare(
        'INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, source, updatedAt, fees, taxes, _xmlid, _order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const insertCE = sqlite.prepare(
        'INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES (?, ?, ?, ?, ?)',
      );

      let nextXmlid = ((sqlite.prepare('SELECT COALESCE(MAX(_xmlid), 0) + 1 AS n FROM xact').get() as { n: number }).n);
      let nextOrder = ((sqlite.prepare('SELECT COALESCE(MAX(_order), 0) + 1 AS n FROM xact').get() as { n: number }).n);
      const now = new Date().toISOString();

      for (const tx of txns) {
        insertXact.run(
          tx.id, tx.type, tx.date, tx.currency, tx.amount, tx.shares,
          tx.note, tx.securityId, tx.accountId, tx.acctype, tx.source,
          now, tx.fees, tx.taxes, nextXmlid, nextOrder,
        );
        nextXmlid++; // native-ok
        nextOrder++; // native-ok
      }

      for (const ce of entries) {
        insertCE.run(ce.fromXact, ce.fromAcc, ce.toXact, ce.toAcc, ce.type);
      }
    });

    doInsert(mapped.transactions, mapped.crossEntries);

    // Cleanup temp file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    return {
      imported: mapped.transactions.length, // native-ok
      created: {
        transactions: mapped.transactions.length, // native-ok
        securities: createdSecurities,
      },
      errors: mapped.errors,
    };
  } finally {
    releaseLock();
  }
}

// ─── Price Execute ────────────────────────────────

interface PriceExecuteInput {
  tempFileId: string;
  securityId: string;
  columnMapping: { date: number; close: number; high?: number; low?: number; volume?: number };
  delimiter?: CsvDelimiter;
  dateFormat: string;
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';
  skipLines: number;
}

const PRICE_BATCH_SIZE = 5000; // native-ok

export async function executePriceImport(
  sqlite: BetterSqlite3.Database,
  input: PriceExecuteInput,
): Promise<PriceExecuteResult> {
  if (isImportLocked()) throw new CsvImportError('IMPORT_IN_PROGRESS', 'Another import is running');

  const filePath = getTempFilePath(input.tempFileId);
  if (!filePath) throw new CsvImportError('TEMP_FILE_EXPIRED', 'Temp file not found');

  acquireLock();
  try {
    // Auto-detect delimiter if not provided
    let delimiter: CsvDelimiter = input.delimiter ?? ',';
    if (!input.delimiter) {
      const detected = await parseCsvFile(filePath, { skipLines: input.skipLines });
      delimiter = detected.detectedDelimiter;
    }

    // Normalize all rows
    const normalizedRows: NormalizedPriceRow[] = [];
    const errors: RowError[] = [];

    let rowNum = 1; // native-ok
    for await (const fields of parseCsvRows(filePath, { delimiter, skipLines: input.skipLines })) {
      const rawDate = fields[input.columnMapping.date] ?? '';
      const date = parseDate(rawDate, input.dateFormat);
      if (!date) {
        errors.push({ row: rowNum, column: 'date', value: rawDate, code: 'INVALID_DATE', message: 'csvImport.errors.invalidDate' });
        rowNum++; // native-ok
        continue;
      }

      const rawClose = fields[input.columnMapping.close] ?? '';
      const close = parseNumber(rawClose, input.decimalSeparator, input.thousandSeparator);
      if (close == null) {
        errors.push({ row: rowNum, column: 'close', value: rawClose, code: 'INVALID_NUMBER', message: 'csvImport.errors.invalidNumber' });
        rowNum++; // native-ok
        continue;
      }

      const row: NormalizedPriceRow = { rowNumber: rowNum, date, close };

      if (input.columnMapping.high != null) {
        const v = parseNumber(fields[input.columnMapping.high] ?? '', input.decimalSeparator, input.thousandSeparator);
        if (v != null) row.high = v;
      }
      if (input.columnMapping.low != null) {
        const v = parseNumber(fields[input.columnMapping.low] ?? '', input.decimalSeparator, input.thousandSeparator);
        if (v != null) row.low = v;
      }
      if (input.columnMapping.volume != null) {
        const v = parseNumber(fields[input.columnMapping.volume] ?? '', input.decimalSeparator, input.thousandSeparator);
        if (v != null) row.volume = Math.round(v);
      }

      normalizedRows.push(row);
      rowNum++; // native-ok
    }

    // Map
    const mapped = mapPriceRows(normalizedRows, input.securityId);
    errors.push(...mapped.errors);

    // Chunked INSERT OR IGNORE
    let inserted = 0; // native-ok
    let skipped = 0; // native-ok

    const insertStmt = sqlite.prepare(
      'INSERT OR IGNORE INTO price (security, tstamp, value, high, low, volume) VALUES (?, ?, ?, ?, ?, ?)',
    );

    const insertBatch = sqlite.transaction((batch: PriceInsert[]) => {
      for (const p of batch) {
        const result = insertStmt.run(p.securityId, p.date, p.close, p.high ?? null, p.low ?? null, p.volume ?? null);
        if (result.changes > 0) { // native-ok
          inserted++; // native-ok
        } else {
          skipped++; // native-ok
        }
      }
    });

    for (let i = 0; i < mapped.prices.length; i += PRICE_BATCH_SIZE) { // native-ok
      const batch = mapped.prices.slice(i, i + PRICE_BATCH_SIZE); // native-ok
      insertBatch(batch);
    }

    // Sync latest_price from max date in price table
    const maxRow = sqlite.prepare(
      'SELECT tstamp, value, high, low, volume FROM price WHERE security = ? ORDER BY tstamp DESC LIMIT 1',
    ).get(input.securityId) as { tstamp: string; value: number; high: number | null; low: number | null; volume: number | null } | undefined;

    if (maxRow) {
      sqlite.prepare(
        `INSERT INTO latest_price (security, tstamp, value, high, low, volume) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(security) DO UPDATE SET tstamp = excluded.tstamp, value = excluded.value, high = excluded.high, low = excluded.low, volume = excluded.volume`,
      ).run(input.securityId, maxRow.tstamp, maxRow.value, maxRow.high, maxRow.low, maxRow.volume);
    }

    // Date range
    const dates = mapped.prices.map((p) => p.date).sort();
    const dateRange = {
      from: dates[0] ?? '',
      to: dates[dates.length - 1] ?? '', // native-ok
    };

    // Cleanup temp file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    return { inserted, skipped, errors, dateRange };
  } finally {
    releaseLock();
  }
}

// ─── Error class ──────────────────────────────────

export class CsvImportError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'CsvImportError';
  }
}
