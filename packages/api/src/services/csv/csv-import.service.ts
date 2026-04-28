// packages/api/src/services/csv/csv-import.service.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  parseDate, parseNumber, normalizeTransactionType,
  ppRateToQvRate, verifyGrossRateValue,
  autodetectCsvFormat,
  CROSS_CURRENCY_FX_TYPES, TransactionType,
  type NormalizedTradeRow, type NormalizedPriceRow,
  type RowError, type CsvParseResult, type TradePreviewResult,
  type TradeExecuteResult, type PriceExecuteResult, type PreviewRow,
  type UnmatchedSecurity, type CsvDelimiter,
} from '@quovibe/shared';
import { parseCsvFile, parseCsvRows } from './csv-reader';
import {
  mapTradeRows, toSharesDb,
  type TradeMapperContext, type XactInsert, type CrossEntryInsert, type UnitInsert,
} from './csv-trade-mapper';
import { mapPriceRows, type PriceInsert } from './csv-price-mapper';
import { getRate } from '../fx.service';

// BUG-100: placeholder used only inside previewTradeImport's in-memory
// securityMap for create-new rows. Never written to DB, never compared
// downstream.
const PREVIEW_PENDING_NEW_SENTINEL = '__PENDING_NEW__';

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

// ─── Cross-currency helpers ───────────────────────

const FX_ERROR_CODES = new Set([
  'FX_RATE_REQUIRED', 'INVALID_FX_RATE', 'FX_VERIFICATION_FAILED', 'CURRENCY_MISMATCH',
]);

// Pre-mapping (CSV-row) type sets. SECURITY_TRANSFER is treated as outflow:
// the row's source portfolio = `accountId`, the row's `crossAccountId` is the
// destination — auditing the destination would need a symmetric pass and is
// out of scope today.
const SHARES_INFLOW_TYPES = new Set<TransactionType>([
  TransactionType.BUY,
  TransactionType.DELIVERY_INBOUND,
]);
const SHARES_OUTFLOW_TYPES = new Set<TransactionType>([
  TransactionType.SELL,
  TransactionType.DELIVERY_OUTBOUND,
  TransactionType.SECURITY_TRANSFER,
]);

// Post-mapping (xact-row) type sets. SECURITY_TRANSFER is decomposed by
// `csv-trade-mapper.ts` Group D into TRANSFER_OUT / TRANSFER_IN xact rows,
// so the SQL CASE that audits existing holdings keys on the post-mapping
// names instead of the pre-mapping enum.
const DB_INFLOW_TYPE_LITERALS = ['BUY', 'TRANSFER_IN', 'DELIVERY_INBOUND'] as const;
const DB_OUTFLOW_TYPE_LITERALS = ['SELL', 'TRANSFER_OUT', 'DELIVERY_OUTBOUND'] as const;

// Walks `rows` in chronological order (date asc, then rowNumber asc as
// tie-breaker), maintaining a running shares balance per security at the
// target portfolio. Outflow rows whose required shares exceed the running
// balance get an INSUFFICIENT_SHARES error; their delta is NOT applied so a
// single bad SELL doesn't poison subsequent unrelated rows. Pending-new
// securities (sentinel-mapped) skip the gate — caller re-runs at execute
// once the security UUID exists.
function checkInventoryFeasibility(
  sqlite: BetterSqlite3.Database,
  rows: NormalizedTradeRow[],
  securityMap: Map<string, string>,
  portfolioId: string,
  pendingSentinel: string | null,
): RowError[] {
  const errors: RowError[] = [];

  const touched = new Set<string>();
  for (const row of rows) {
    const txType = row.type as TransactionType;
    if (!SHARES_INFLOW_TYPES.has(txType) && !SHARES_OUTFLOW_TYPES.has(txType)) continue;
    if (!row.securityName) continue;
    const secId = securityMap.get(row.securityName);
    if (!secId) continue;
    if (pendingSentinel && secId === pendingSentinel) continue;
    touched.add(secId);
  }

  if (touched.size === 0) return errors;

  const secPlaceholders = Array.from(touched).map(() => '?').join(','); // native-ok
  const inflowList = DB_INFLOW_TYPE_LITERALS.map((t) => `'${t}'`).join(',');
  const outflowList = DB_OUTFLOW_TYPE_LITERALS.map((t) => `'${t}'`).join(',');
  const balanceRows = sqlite.prepare(
    `SELECT security, COALESCE(SUM(CASE
       WHEN type IN (${inflowList}) THEN shares
       WHEN type IN (${outflowList}) THEN -shares
       ELSE 0
     END), 0) AS net_shares
     FROM xact
     WHERE account = ? AND security IN (${secPlaceholders})
     GROUP BY security`,
  ).all(portfolioId, ...touched) as Array<{ security: string; net_shares: number }>;

  const balance = new Map<string, number>();
  for (const id of touched) balance.set(id, 0);
  for (const r of balanceRows) balance.set(r.security, r.net_shares);

  // Same-date BUY-then-SELL is intuitively read in CSV order; reversing
  // would reject valid same-day round trips.
  const sorted = [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1; // native-ok
    return a.rowNumber - b.rowNumber; // native-ok
  });

  for (const row of sorted) {
    const txType = row.type as TransactionType;
    const isOutflow = SHARES_OUTFLOW_TYPES.has(txType);
    if (!isOutflow && !SHARES_INFLOW_TYPES.has(txType)) continue;
    if (!row.securityName) continue;
    const secId = securityMap.get(row.securityName);
    if (!secId) continue;
    if (pendingSentinel && secId === pendingSentinel) continue;
    if (row.shares == null || row.shares <= 0) continue; // mapper handles MISSING_SHARES

    const sharesDb = toSharesDb(row.shares);
    const current = balance.get(secId) ?? 0;

    if (isOutflow && sharesDb > current) {
      errors.push({
        row: row.rowNumber,
        column: 'shares',
        value: String(row.shares),
        code: 'INSUFFICIENT_SHARES',
        message: 'csvImport.errors.insufficientShares',
      });
      continue;
    }
    balance.set(secId, current + (isOutflow ? -sharesDb : sharesDb));
  }

  return errors;
}

// Throws a CsvImportError when any error in `errors` matches `match`. Mirrors
// the FX / inventory hard-abort symmetry — both gates need find + count + throw,
// only the predicate and the emitted code differ.
function abortIfMatch(
  errors: RowError[],
  match: (e: RowError) => boolean,
  code: string,
  msg: (n: number) => string,
): void {
  const hits = errors.filter(match);
  if (hits.length > 0) throw new CsvImportError(code, msg(hits.length));
}

interface ParseTradeOpts {
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';
  dateFormat: string;
}

// Parse one CSV row's fields into a `NormalizedTradeRow`. Returns either the
// normalized row or a `RowError` describing the first show-stopper. Used by
// both `previewTradeImport` and `executeTradeImport` so the column-by-column
// behavior cannot drift between the two.
function parseTradeRow(
  rowNum: number,
  fields: string[],
  columnMapping: Record<string, number>,
  opts: ParseTradeOpts,
): NormalizedTradeRow | RowError {
  const idx = (k: string): number | undefined => columnMapping[k];

  const rawDate = idx('date') != null ? fields[idx('date')!] ?? '' : '';
  const date = parseDate(rawDate, opts.dateFormat);
  if (!date) {
    return { row: rowNum, column: 'date', value: rawDate, code: 'INVALID_DATE', message: 'csvImport.errors.invalidDate' };
  }

  const rawType = idx('type') != null ? fields[idx('type')!] ?? '' : '';
  const txType = normalizeTransactionType(rawType);
  if (!txType) {
    return { row: rowNum, column: 'type', value: rawType, code: 'UNKNOWN_TYPE', message: 'csvImport.errors.unknownType' };
  }

  const rawAmount = idx('amount') != null ? fields[idx('amount')!] ?? '' : '';
  const amount = parseNumber(rawAmount, opts.decimalSeparator, opts.thousandSeparator);
  if (amount == null) {
    return { row: rowNum, column: 'amount', value: rawAmount, code: 'INVALID_NUMBER', message: 'csvImport.errors.invalidNumber' };
  }

  const row: NormalizedTradeRow = {
    rowNumber: rowNum,
    date,
    type: txType,
    securityName: idx('security') != null ? (fields[idx('security')!] ?? '').trim() : '',
    isin: idx('isin') != null ? ((fields[idx('isin')!] ?? '').trim() || undefined) : undefined,
    ticker: idx('ticker') != null ? ((fields[idx('ticker')!] ?? '').trim() || undefined) : undefined,
    amount,
  };

  if (idx('shares') != null) {
    const shares = parseNumber(fields[idx('shares')!] ?? '', opts.decimalSeparator, opts.thousandSeparator);
    if (shares != null) row.shares = shares;
  }
  if (idx('fees') != null) {
    const fees = parseNumber(fields[idx('fees')!] ?? '', opts.decimalSeparator, opts.thousandSeparator);
    if (fees != null) row.fees = fees;
  }
  if (idx('taxes') != null) {
    const taxes = parseNumber(fields[idx('taxes')!] ?? '', opts.decimalSeparator, opts.thousandSeparator);
    if (taxes != null) row.taxes = taxes;
  }
  if (idx('currency') != null) {
    const cur = (fields[idx('currency')!] ?? '').trim();
    if (cur) row.currency = cur;
  }
  if (idx('note') != null) {
    const note = (fields[idx('note')!] ?? '').trim();
    if (note) row.note = note;
  }
  if (idx('crossAccount') != null) {
    const crossAccount = (fields[idx('crossAccount')!] ?? '').trim();
    if (crossAccount) row.crossAccountId = crossAccount;
  }
  if (idx('grossAmount') != null) {
    const g = parseNumber(fields[idx('grossAmount')!] ?? '', opts.decimalSeparator, opts.thousandSeparator);
    if (g != null) row.grossAmount = g;
  }
  if (idx('currencyGrossAmount') != null) {
    const c = (fields[idx('currencyGrossAmount')!] ?? '').trim().toUpperCase();
    if (c) row.currencyGrossAmount = c;
  }
  // PP-parity columns: accept-and-ignore. WKN/Time/Date-of-Quote are read
  // here so that strict schema modes don't reject them. They do not influence
  // the resulting NormalizedTradeRow.
  if (idx('wkn') != null) {
    void fields[idx('wkn')!];
  }
  if (idx('time') != null) {
    void fields[idx('time')!];
  }
  if (idx('dateOfQuote') != null) {
    void fields[idx('dateOfQuote')!];
  }

  // `Exchange Rate` column carries the PP convention (deposit-per-security).
  // Stored on the row in qv convention (security-per-deposit) so the mapper
  // and the FOREX xact_unit emit byte-identical values to transaction.service.
  // Empty/zero rate is treated as "absent" rather than INVALID_FX_RATE: PP's
  // own BUY example (csv-import.md:151) leaves the column blank for
  // same-currency rows, so blank must mean "skip the rate, not invalid".
  if (idx('fxRate') != null) {
    const raw = (fields[idx('fxRate')!] ?? '').trim();
    if (raw) {
      const ppRate = parseNumber(raw, opts.decimalSeparator, opts.thousandSeparator);
      if (ppRate == null || ppRate <= 0) {
        return { row: rowNum, column: 'fxRate', value: raw, code: 'INVALID_FX_RATE', message: 'csvImport.errors.invalidFxRate' };
      }
      const qv = ppRateToQvRate(ppRate);
      if (qv == null) {
        return { row: rowNum, column: 'fxRate', value: raw, code: 'INVALID_FX_RATE', message: 'csvImport.errors.invalidFxRate' };
      }
      row.fxRate = qv;
      // Stash the raw PP rate on the row only long enough to run the
      // PP step-2 `Gross × Rate = Value` check downstream. Held in a
      // closure-scoped Map (see `enrichRowsWithFxChecks`), not here.
    }
  }

  return row;
}

// Build a securityId → currency map from a securityMap that may contain
// pending-new sentinels. Pending entries are silently dropped (caller's
// responsibility to seed them with `input.newSecurities[].currency` at
// execute time).
function buildSecurityCurrencyMap(
  sqlite: BetterSqlite3.Database,
  securityIds: Iterable<string>,
  pendingSentinel?: string,
): Map<string, string> {
  const ids = new Set<string>();
  for (const id of securityIds) {
    if (!id) continue;
    if (pendingSentinel && id === pendingSentinel) continue;
    ids.add(id);
  }
  const out = new Map<string, string>();
  if (ids.size === 0) return out;
  const placeholders = Array.from(ids).map(() => '?').join(','); // native-ok
  const rows = sqlite.prepare(
    `SELECT uuid, currency FROM security WHERE uuid IN (${placeholders})`,
  ).all(...ids) as Array<{ uuid: string; currency: string | null }>;
  for (const r of rows) {
    if (r.currency) out.set(r.uuid, r.currency);
  }
  return out;
}

// Build an accountUuid → currency map for a set of account UUIDs (commonly
// `crossAccountId` values plus the source deposit account).
function buildAccountCurrencyMap(
  sqlite: BetterSqlite3.Database,
  accountIds: Iterable<string>,
): Map<string, string> {
  const ids = new Set<string>();
  for (const id of accountIds) {
    if (id) ids.add(id);
  }
  const out = new Map<string, string>();
  if (ids.size === 0) return out;
  const placeholders = Array.from(ids).map(() => '?').join(','); // native-ok
  const rows = sqlite.prepare(
    `SELECT uuid, currency FROM account WHERE uuid IN (${placeholders})`,
  ).all(...ids) as Array<{ uuid: string; currency: string | null }>;
  for (const r of rows) {
    if (r.currency) out.set(r.uuid, r.currency);
  }
  return out;
}

interface FxEnrichmentInput {
  rows: NormalizedTradeRow[];
  securityMap: Map<string, string>;
  securityCurrencyMap: Map<string, string>;
  accountCurrencyMap: Map<string, string>;
  depositCurrency: string;
}

// For every cross-currency row missing an `fxRate`, attempt to fill it from
// the `vf_exchange_rate` cache via `getRate`. Then run the PP step-2
// `Gross × Rate = Value` consistency check and the `Currency Gross Amount`
// pin. Returns the row errors collected; the rows are mutated in place.
function enrichRowsWithFxChecks(
  sqlite: BetterSqlite3.Database,
  input: FxEnrichmentInput,
): RowError[] {
  const errors: RowError[] = [];

  for (const row of input.rows) {
    const txType = row.type as TransactionType;
    if (!CROSS_CURRENCY_FX_TYPES.has(txType)) continue;

    let secCcy: string | null = null;
    let otherCcy: string | null = null;

    if (txType === TransactionType.BUY || txType === TransactionType.SELL) {
      const secId = row.securityName ? input.securityMap.get(row.securityName) : undefined;
      if (!secId) continue; // pending-new or unmatched — gate runs at execute
      secCcy = input.securityCurrencyMap.get(secId) ?? null;
      otherCcy = secCcy;
    } else if (txType === TransactionType.TRANSFER_BETWEEN_ACCOUNTS) {
      if (!row.crossAccountId) continue;
      otherCcy = input.accountCurrencyMap.get(row.crossAccountId) ?? null;
    }

    if (!otherCcy || otherCcy === input.depositCurrency) continue;

    // Auto-fill missing rate from the vf_exchange_rate cache. Mirrors PP's
    // "automatic" cross-currency behavior described in csv-import.md:142.
    // Convention: getRate(deposit, security) returns security-per-deposit
    // = qv convention, ready to store on row.fxRate as-is.
    if (row.fxRate == null) {
      const cached = getRate(sqlite, input.depositCurrency, otherCcy, row.date);
      if (cached && !cached.isZero()) {
        row.fxRate = cached.toNumber();
      } else {
        errors.push({
          row: row.rowNumber,
          column: 'fxRate',
          code: 'FX_RATE_REQUIRED',
          message: 'csvImport.errors.fxRateRequired',
        });
        continue;
      }
    }

    // PP step-2 `Gross × Rate = Value` check. PP rate (deposit-per-security)
    // = 1 / qv rate. row.amount carries PP's "Value" in deposit ccy;
    // row.grossAmount carries PP's "Gross Amount" in security ccy. If the
    // user did not provide grossAmount the check is skipped — PP's BUY
    // example (csv-import.md:151) does not require it either.
    if (row.grossAmount != null && row.fxRate > 0) {
      const ppRate = 1 / row.fxRate;
      if (!verifyGrossRateValue(row.grossAmount, ppRate, row.amount)) {
        errors.push({
          row: row.rowNumber,
          column: 'grossAmount',
          code: 'FX_VERIFICATION_FAILED',
          message: 'csvImport.errors.fxVerificationFailed',
        });
        continue;
      }
    }

    // CURRENCY_MISMATCH: explicit `Currency Gross Amount` must match the
    // resolved security currency (BUY/SELL only — transfers don't carry a
    // security).
    if (
      (txType === TransactionType.BUY || txType === TransactionType.SELL) &&
      row.currencyGrossAmount && secCcy &&
      row.currencyGrossAmount !== secCcy
    ) {
      errors.push({
        row: row.rowNumber,
        column: 'currencyGrossAmount',
        value: row.currencyGrossAmount,
        code: 'CURRENCY_MISMATCH',
        message: 'csvImport.errors.currencyMismatch',
      });
    }
  }

  return errors;
}

// ─── Parse (Step 1) ───────────────────────────────

export async function parseCsv(
  tempFileId: string,
  opts: { delimiter?: CsvDelimiter; skipLines?: number },
): Promise<CsvParseResult> {
  const filePath = getTempFilePath(tempFileId);
  if (!filePath) throw new CsvImportError('TEMP_FILE_EXPIRED', 'Temp file not found');

  const result = await parseCsvFile(filePath, opts);
  const autodetected = autodetectCsvFormat(result.headers, result.sampleRows);
  return {
    tempFileId,
    headers: result.headers,
    sampleRows: result.sampleRows,
    detectedDelimiter: result.detectedDelimiter,
    totalRows: result.totalRows,
    autodetected,
  };
}

// ─── Trade Preview (Step 2-3) ─────────────────────

interface TradePreviewInput {
  tempFileId: string;
  delimiter?: CsvDelimiter;
  columnMapping: Record<string, number>;
  dateFormat: string;
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';
  targetSecuritiesAccountId: string;
  // BUG-100: on the second preview call (Step 3 → Next), the client sends the
  // finalized security resolutions so the summary reflects what execute will
  // actually do. The initial Step-3-entry call omits both fields; the server
  // falls back to auto-matching then.
  securityMapping?: Record<string, string>;  // csvName → existing security.uuid
  newSecurityNames?: string[];                // csvNames flagged for create-new
}

export async function previewTradeImport(
  sqlite: BetterSqlite3.Database,
  input: TradePreviewInput,
): Promise<TradePreviewResult> {
  const filePath = getTempFilePath(input.tempFileId);
  if (!filePath) throw new CsvImportError('TEMP_FILE_EXPIRED', 'Temp file not found');

  // Resolve securities account -> deposit account
  const acctRow = sqlite.prepare(
    'SELECT uuid, type, currency, referenceAccount FROM account WHERE uuid = ?',
  ).get(input.targetSecuritiesAccountId) as { uuid: string; type: string; currency: string | null; referenceAccount: string | null } | undefined;

  if (!acctRow || acctRow.type !== 'portfolio') {
    throw new CsvImportError('INVALID_SECURITIES_ACCOUNT', 'Not a securities account (type=portfolio)');
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
    const parsed = parseTradeRow(rowNum, fields, input.columnMapping, {
      decimalSeparator: input.decimalSeparator,
      thousandSeparator: input.thousandSeparator,
      dateFormat: input.dateFormat,
    });
    if ('code' in parsed) {
      rowErrors.push(parsed);
    } else {
      normalizedRows.push(parsed);
    }
    rowNum++; // native-ok
  }

  // Extract unique securities for matching, plus collect distinct CGA values
  // per csvName for new-security currency resolution.
  const uniqueSecurities = new Map<string, { isin?: string; ticker?: string }>();
  const csvCurrenciesByName = new Map<string, Set<string>>();
  for (const row of normalizedRows) {
    if (!row.securityName) continue;
    if (!uniqueSecurities.has(row.securityName)) {
      uniqueSecurities.set(row.securityName, { isin: row.isin, ticker: row.ticker });
    }
    if (row.currencyGrossAmount) {
      const set = csvCurrenciesByName.get(row.securityName) ?? new Set<string>();
      set.add(row.currencyGrossAmount);
      csvCurrenciesByName.set(row.securityName, set);
    }
  }
  const buildCsvCurrencies = (csvName: string): string[] | undefined => {
    const set = csvCurrenciesByName.get(csvName);
    if (!set || set.size === 0) return undefined;
    return Array.from(set).sort();
  };

  // Auto-match securities. Skip the DB round-trips for names the client has
  // already resolved (user picked existing or flagged create-new on Step 3)
  // — the overlay loop below would overwrite the auto-match anyway. UI still
  // needs an unmatchedSecurities row for those names, so we push a bare
  // entry in the skip branch.
  const securityMap = new Map<string, string>();
  const unmatchedSecurities: UnmatchedSecurity[] = [];
  const clientResolved = new Set<string>([
    ...Object.keys(input.securityMapping ?? {}),
    ...(input.newSecurityNames ?? []),
  ]);

  for (const [csvName, info] of uniqueSecurities) {
    if (clientResolved.has(csvName)) {
      unmatchedSecurities.push({
        csvName,
        csvIsin: info.isin,
        csvTicker: info.ticker,
        csvCurrencies: buildCsvCurrencies(csvName),
      });
      continue;
    }

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
        csvCurrencies: buildCsvCurrencies(csvName),
      });
    } else {
      unmatchedSecurities.push({
        csvName,
        csvIsin: info.isin,
        csvTicker: info.ticker,
        csvCurrencies: buildCsvCurrencies(csvName),
      });
    }
  }

  // BUG-100: overlay user-provided resolutions on top of auto-matches.
  //  (1) user-matched: overrides any auto-match for the same csvName.
  //  (2) pending-create: placeholder sentinel so the mapper's
  //      SECURITY_REQUIRED_TYPES guard passes. The sentinel is NEVER persisted
  //      (preview writes nothing) and is never compared for equality
  //      downstream — execute regenerates real UUIDs via uuidv4() and seeds
  //      its own securityMap from `input.securityMapping` + newly-created
  //      security UUIDs. Keep this comment if the sentinel ever changes.
  for (const [csvName, secId] of Object.entries(input.securityMapping ?? {})) {
    securityMap.set(csvName, secId);
  }
  for (const name of input.newSecurityNames ?? []) {
    if (!securityMap.has(name)) {
      securityMap.set(name, PREVIEW_PENDING_NEW_SENTINEL);
    }
  }

  // Build currency maps + auto-fill missing fxRate from cache + run PP
  // step-2 verification + CURRENCY_MISMATCH check. Pending-new securities
  // are absent from `securityCurrencyMap` (sentinel filtered) and therefore
  // skip the gate at preview; execute catches them once real UUIDs exist.
  const securityCurrencyMap = buildSecurityCurrencyMap(
    sqlite, securityMap.values(), PREVIEW_PENDING_NEW_SENTINEL,
  );
  const accountCurrencyMap = buildAccountCurrencyMap(
    sqlite,
    normalizedRows.map((r) => r.crossAccountId).filter((x): x is string => !!x),
  );
  const fxErrors = enrichRowsWithFxChecks(sqlite, {
    rows: normalizedRows,
    securityMap,
    securityCurrencyMap,
    accountCurrencyMap,
    depositCurrency: portfolioCurrency,
  });

  // Pending-new securities skip the gate here (sentinel filter); execute
  // re-runs the check once real UUIDs exist.
  const inventoryErrors = checkInventoryFeasibility(
    sqlite, normalizedRows, securityMap,
    input.targetSecuritiesAccountId, PREVIEW_PENDING_NEW_SENTINEL,
  );

  // Map to transactions for preview
  const ctx: TradeMapperContext = {
    portfolioId: input.targetSecuritiesAccountId,
    depositAccountId: acctRow.referenceAccount,
    portfolioCurrency,
    securityMap,
    securityCurrencyMap,
    accountCurrencyMap,
  };

  const mapped = mapTradeRows(normalizedRows, ctx);

  const allMapperErrors = [...fxErrors, ...inventoryErrors, ...mapped.errors];

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
    error: allMapperErrors.find((e) => e.row === row.rowNumber),
  }));

  // Summary
  const byType: Record<string, number> = {};
  for (const row of normalizedRows) {
    byType[row.type] = (byType[row.type] ?? 0) + 1; // native-ok
  }

  // Count rows whose natural key would dedupe at execute time. Build a
  // fingerprint set from existing CSV-source xacts once, then check each
  // mapped XactInsert against it. Counts BOTH legs of BUY/SELL (matches the
  // wire-level skippedDuplicates returned by execute).
  const existingFingerprints = new Set<string>();
  const existingRows = sqlite.prepare(
    "SELECT date, type, security, account, shares, amount FROM xact WHERE source = 'CSV_IMPORT'",
  ).all() as Array<{
    date: string; type: string; security: string | null;
    account: string; shares: number; amount: number;
  }>;
  for (const r of existingRows) {
    existingFingerprints.add(
      `${r.date}|${r.type}|${r.security ?? ''}|${r.account}|${r.shares}|${r.amount}`,
    );
  }
  let duplicates = 0; // native-ok
  for (const tx of mapped.transactions) {
    const fp = `${tx.date}|${tx.type}|${tx.securityId ?? ''}|${tx.accountId}|${tx.shares}|${tx.amount}`;
    if (existingFingerprints.has(fp)) duplicates++; // native-ok
  }

  return {
    rows: previewRows,
    unmatchedSecurities,
    errors: [...rowErrors, ...allMapperErrors],
    summary: {
      total: normalizedRows.length + rowErrors.length, // native-ok
      valid: normalizedRows.length - allMapperErrors.length, // native-ok
      errors: rowErrors.length + allMapperErrors.length, // native-ok
      duplicates,
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
  targetSecuritiesAccountId: string;
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
    // Resolve securities account -> deposit
    const acctRow = sqlite.prepare(
      'SELECT uuid, type, currency, referenceAccount FROM account WHERE uuid = ?',
    ).get(input.targetSecuritiesAccountId) as { uuid: string; type: string; currency: string | null; referenceAccount: string | null };

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

    // Re-parse and normalize (same parser as preview).
    const normalizedRows: NormalizedTradeRow[] = [];
    const parseRowErrors: RowError[] = [];
    const excludedSet = new Set(input.excludedRows);

    let rowNum = 1; // native-ok
    for await (const fields of parseCsvRows(filePath, { delimiter: input.config.delimiter, skipLines: 0 })) {
      if (excludedSet.has(rowNum)) {
        rowNum++; // native-ok
        continue;
      }

      const parsed = parseTradeRow(rowNum, fields, input.config.columnMapping, {
        decimalSeparator: input.config.decimalSeparator,
        thousandSeparator: input.config.thousandSeparator,
        dateFormat: input.config.dateFormat,
      });
      if ('code' in parsed) {
        parseRowErrors.push(parsed);
      } else {
        normalizedRows.push(parsed);
      }
      rowNum++; // native-ok
    }

    // Build currency maps. New securities created above already live in
    // `securityMap` with real UUIDs; seed `securityCurrencyMap` with the
    // user-supplied currency from `input.newSecurities`. Pending sentinels
    // never appear here because execute always resolves them first.
    const securityCurrencyMap = buildSecurityCurrencyMap(sqlite, securityMap.values());
    for (const sec of input.newSecurities) {
      const id = securityMap.get(sec.name);
      if (id) securityCurrencyMap.set(id, sec.currency);
    }
    const accountCurrencyMap = buildAccountCurrencyMap(
      sqlite,
      normalizedRows.map((r) => r.crossAccountId).filter((x): x is string => !!x),
    );

    // Defense-in-depth: re-run the FX enrichment + checks at execute time.
    // Pending-new securities that bypassed the preview gate are caught here
    // because their currency now exists in `securityCurrencyMap`.
    const fxErrors = enrichRowsWithFxChecks(sqlite, {
      rows: normalizedRows,
      securityMap,
      securityCurrencyMap,
      accountCurrencyMap,
      depositCurrency: portfolioCurrency,
    });

    // Re-run at execute. Pending-new securities are now resolved (real UUIDs
    // minted above), so they're checked too — that's why `pendingSentinel`
    // is `null` here but `PREVIEW_PENDING_NEW_SENTINEL` at preview.
    const inventoryErrors = checkInventoryFeasibility(
      sqlite, normalizedRows, securityMap,
      input.targetSecuritiesAccountId, null,
    );

    // Map
    const ctx: TradeMapperContext = {
      portfolioId: input.targetSecuritiesAccountId,
      depositAccountId: acctRow.referenceAccount!,
      portfolioCurrency,
      securityMap,
      securityCurrencyMap,
      accountCurrencyMap,
    };

    const mapped = mapTradeRows(normalizedRows, ctx);

    // Hard-abort on any FX-class or inventory error before opening the SQLite
    // transaction. Deliberately stricter than the soft-skip posture used for
    // MISSING_SHARES / MISSING_SECURITY / MISSING_CROSS_ACCOUNT — see
    // `.claude/rules/csv-import.md` Cross-currency FX gate.
    const allMapperErrors = [...fxErrors, ...inventoryErrors, ...mapped.errors];
    abortIfMatch(
      allMapperErrors,
      (e) => FX_ERROR_CODES.has(e.code),
      'FX_RATE_REQUIRED',
      (n) => `${n} row(s) require FX information that the CSV import cannot resolve`,
    );
    abortIfMatch(
      allMapperErrors,
      (e) => e.code === 'INSUFFICIENT_SHARES',
      'INSUFFICIENT_SHARES',
      (n) => `${n} row(s) sell more shares than available at that point in time`,
    );

    // Insert all in a single SQLite transaction. INSERT OR IGNORE +
    // RETURNING uuid lets us detect rows the partial unique index on
    // (date,type,security,account,shares,amount) WHERE source='CSV_IMPORT'
    // silently dropped — used to skip dependent xact_unit/xact_cross_entry
    // inserts that would otherwise reference a non-existent xact UUID.
    const doInsert = sqlite.transaction((
      txns: XactInsert[], entries: CrossEntryInsert[], unitRows: UnitInsert[],
    ): { skipped: number } => {
      const insertXact = sqlite.prepare(
        'INSERT OR IGNORE INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, source, updatedAt, fees, taxes, _xmlid, _order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING uuid',
      );
      const insertCE = sqlite.prepare(
        'INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES (?, ?, ?, ?, ?)',
      );
      const insertUnit = sqlite.prepare(
        'INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );

      let nextXmlid = ((sqlite.prepare('SELECT COALESCE(MAX(_xmlid), 0) + 1 AS n FROM xact').get() as { n: number }).n);
      let nextOrder = ((sqlite.prepare('SELECT COALESCE(MAX(_order), 0) + 1 AS n FROM xact').get() as { n: number }).n);
      const now = new Date().toISOString();

      const skippedUuids = new Set<string>();
      let skipped = 0; // native-ok

      for (const tx of txns) {
        const returned = insertXact.get(
          tx.id, tx.type, tx.date, tx.currency, tx.amount, tx.shares,
          tx.note, tx.securityId, tx.accountId, tx.acctype, tx.source,
          now, tx.fees, tx.taxes, nextXmlid, nextOrder,
        ) as { uuid: string } | undefined;
        if (returned == null) {
          skippedUuids.add(tx.id);
          skipped++; // native-ok
        }
        nextXmlid++; // native-ok
        nextOrder++; // native-ok
      }

      for (const ce of entries) {
        if (skippedUuids.has(ce.fromXact) || skippedUuids.has(ce.toXact)) continue;
        insertCE.run(ce.fromXact, ce.fromAcc, ce.toXact, ce.toAcc, ce.type);
      }

      for (const u of unitRows) {
        if (skippedUuids.has(u.xact)) continue;
        insertUnit.run(u.xact, u.type, u.amount, u.currency, u.forex_amount, u.forex_currency, u.exchangeRate);
      }

      return { skipped };
    });

    const insertResult = doInsert(mapped.transactions, mapped.crossEntries, mapped.units);

    // Cleanup temp file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    // Report input-row count rather than raw xact-row count: BUY/SELL and
    // transfers emit 2 xact rows per input row (see csv-trade-mapper);
    // doubling leaks an implementation detail into user-facing copy.
    // Subtract mapper errors because those rows produced no xact. Also
    // subtract input rows fully deduped (both legs skipped) so `imported`
    // reflects what actually persisted.
    const logicalCount = normalizedRows.length - mapped.errors.length; // native-ok
    // skippedDuplicates is in xact-row units (raw skip count). For the
    // user-facing `imported` we approximate input-row dedupes as ceil(skip/2):
    // BUY/SELL emit 2 legs per input, others emit 1. Imperfect for mixed
    // batches but close enough for the toast/copy. The wire still carries
    // the raw skip count for the client to reason about.
    const skippedInputRows = Math.ceil(insertResult.skipped / 2); // native-ok
    return {
      imported: Math.max(0, logicalCount - skippedInputRows),
      skippedDuplicates: insertResult.skipped,
      created: {
        transactions: Math.max(0, logicalCount - skippedInputRows),
        securities: createdSecurities,
      },
      errors: [...parseRowErrors, ...mapped.errors],
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
