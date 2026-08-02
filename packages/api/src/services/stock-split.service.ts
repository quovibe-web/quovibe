import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import {
  formatSplitRatio,
  splitQuoteDb,
  splitSharesDb,
  type SplitRatio,
  type StockSplitInput,
} from '@quovibe/shared';
import { syncLatestPriceFromGlobalMax } from './prices.service';

export type StockSplitErrorCode =
  | 'INVALID_SPLIT_RATIO'
  | 'SECURITY_NOT_FOUND'
  | 'DUPLICATE_SPLIT'
  | 'SPLIT_DEDUPE_CONFLICT';

export class StockSplitError extends Error {
  constructor(
    public readonly code: StockSplitErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StockSplitError';
  }
}

export type SplitWarning = 'FUTURE_EX_DATE' | 'NO_ROWS_AFFECTED';

export interface SplitPreviewTransaction {
  uuid: string;
  date: string;
  type: string;
  accountName: string | null;
  sharesOld: number;
  sharesNew: number;
}

export interface SplitPreviewQuote {
  date: string;
  valueOld: number;
  valueNew: number;
}

export interface SplitPreview {
  transactions: SplitPreviewTransaction[];
  quotes: SplitPreviewQuote[];
  counts: { transactions: number; quotes: number };
  warnings: SplitWarning[];
}

export interface StockSplitResult {
  applied: { transactions: number; quotes: number };
  eventId: number;
}

interface TxRow {
  uuid: string;
  shares: number;
}

interface TxPreviewRow extends TxRow {
  date: string;
  type: string;
  acctype: string;
  accountName: string | null;
  crossAccId: string | null;
  ownAccount: string;
}

interface QuoteRow {
  tstamp: string;
  value: number;
  open: number | null;
  high: number | null;
  low: number | null;
}

// Rows are selected day-granular and strictly before the ex-date. `xact.date`
// and `price.tstamp` are VARCHAR(32) and may carry an ISO time tail, so both
// predicates truncate to the date part — the same convention the CSV dedupe
// fingerprint uses.
// The rewrite only needs the primary key and the share count, so it deliberately
// skips the account join and the type columns the preview needs for labelling.
const SELECT_TRANSACTIONS = `
  SELECT x.uuid AS uuid, x.shares AS shares
  FROM xact x
  WHERE x.security = ? AND substr(x.date, 1, 10) < ?
  ORDER BY x.date, x._order, x._id
`;

const SELECT_TRANSACTIONS_PREVIEW = `
  SELECT x.uuid AS uuid, x.date AS date, x.type AS type, x.shares AS shares,
         x.acctype AS acctype, x.account AS ownAccount, a.name AS accountName,
         (SELECT ce.to_acc FROM xact_cross_entry ce
           WHERE ce.from_xact = x.uuid AND ce.from_xact != ce.to_xact
           LIMIT 1) AS crossAccId
  FROM xact x
  LEFT JOIN account a ON a.uuid = x.account
  WHERE x.security = ? AND substr(x.date, 1, 10) < ?
  ORDER BY x.date, x._order, x._id
`;

/**
 * `xact.type` stores the ppxml2db form, which diverges from the app enum for
 * dividends and the transfer family. Read routes normalize at their own
 * boundary; the preview does the same so the client never has to know about the
 * divergence. Mirrors the mapping in `routes/accounts.ts`.
 */
function normalizeDbType(row: TxPreviewRow): string {
  const hasShares = row.shares != null && row.shares !== 0;
  if (row.type === 'TRANSFER_IN') {
    if (row.acctype === 'portfolio' || hasShares) {
      if (row.crossAccId && row.crossAccId !== row.ownAccount) return 'SECURITY_TRANSFER';
      return 'DELIVERY_INBOUND';
    }
    return 'TRANSFER_BETWEEN_ACCOUNTS';
  }
  if (row.type === 'TRANSFER_OUT') {
    if (row.acctype === 'portfolio' || hasShares) {
      if (row.crossAccId && row.crossAccId !== row.ownAccount) return 'SECURITY_TRANSFER';
      return 'DELIVERY_OUTBOUND';
    }
    return 'TRANSFER_BETWEEN_ACCOUNTS';
  }
  if (row.type === 'DIVIDENDS') return 'DIVIDEND';
  return row.type;
}

const SELECT_QUOTES = `
  SELECT tstamp, value, open, high, low
  FROM price
  WHERE security = ? AND substr(tstamp, 1, 10) < ?
  ORDER BY tstamp
`;

function toRatio(input: StockSplitInput): SplitRatio {
  const newShares = new Decimal(input.newShares);
  const oldShares = new Decimal(input.oldShares);
  if (
    !newShares.isFinite() ||
    !oldShares.isFinite() ||
    newShares.lte(0) ||
    oldShares.lte(0) ||
    newShares.eq(oldShares)
  ) {
    throw new StockSplitError(
      'INVALID_SPLIT_RATIO',
      'Split ratio sides must be positive and must differ',
    );
  }
  return { newShares, oldShares };
}

function assertSecurityExists(sqlite: BetterSqlite3.Database, securityId: string): void {
  const row = sqlite.prepare(`SELECT uuid FROM security WHERE uuid = ?`).get(securityId);
  if (!row) {
    throw new StockSplitError('SECURITY_NOT_FOUND', 'Security not found', { securityId });
  }
}

/** Rescale one quote row; returns null when nothing on the row moves. */
function rescaleQuote(
  row: QuoteRow,
  ratio: SplitRatio,
): { value: number; open: number | null; high: number | null; low: number | null } | null {
  const value = splitQuoteDb(row.value, ratio);
  const open = row.open == null ? null : splitQuoteDb(row.open, ratio);
  const high = row.high == null ? null : splitQuoteDb(row.high, ratio);
  const low = row.low == null ? null : splitQuoteDb(row.low, ratio);
  if (value === row.value && open === row.open && high === row.high && low === row.low) {
    return null;
  }
  return { value, open, high, low };
}

function isUniqueConstraintError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

/** Read-only. Same row selection and arithmetic the apply path uses. */
export function previewStockSplit(
  sqlite: BetterSqlite3.Database,
  input: StockSplitInput,
): SplitPreview {
  assertSecurityExists(sqlite, input.securityId);
  const ratio = toRatio(input);

  const txRows = sqlite
    .prepare(SELECT_TRANSACTIONS_PREVIEW)
    .all(input.securityId, input.exDate) as TxPreviewRow[];
  const quoteRows = sqlite.prepare(SELECT_QUOTES).all(input.securityId, input.exDate) as QuoteRow[];

  const transactions: SplitPreviewTransaction[] = [];
  for (const row of txRows) {
    const sharesNew = splitSharesDb(row.shares, ratio);
    // A row is "affected" only when its share count actually moves. Cash-side
    // rows of a BUY/SELL pair carry shares = 0 and fall out here with no
    // type-specific branch.
    if (sharesNew === row.shares) continue;
    transactions.push({
      uuid: row.uuid,
      date: row.date,
      type: normalizeDbType(row),
      accountName: row.accountName,
      sharesOld: row.shares,
      sharesNew,
    });
  }

  const quotes: SplitPreviewQuote[] = [];
  for (const row of quoteRows) {
    const next = rescaleQuote(row, ratio);
    if (!next) continue;
    quotes.push({ date: row.tstamp, valueOld: row.value, valueNew: next.value });
  }

  const warnings: SplitWarning[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (input.exDate > today) warnings.push('FUTURE_EX_DATE');
  if (transactions.length === 0 && quotes.length === 0) warnings.push('NO_ROWS_AFFECTED');

  return {
    transactions,
    quotes,
    counts: { transactions: transactions.length, quotes: quotes.length },
    warnings,
  };
}

/**
 * Destructive, retroactive rewrite: every share count and every quote strictly
 * before the ex-date is restated as if the split had always been in effect.
 *
 * The event row is a marker recorded unconditionally — it is never read back to
 * adjust a calculation. Rows imported from an external portfolio file describe
 * splits that were already applied before export, so retro-applying a stored
 * event would double-count every one of them.
 */
export function applyStockSplit(
  sqlite: BetterSqlite3.Database,
  input: StockSplitInput,
): StockSplitResult {
  assertSecurityExists(sqlite, input.securityId);
  const ratio = toRatio(input);
  const details = formatSplitRatio(ratio);

  const duplicate = sqlite
    .prepare(
      `SELECT _id FROM security_event
       WHERE security = ? AND date = ? AND type = 'STOCK_SPLIT' AND details = ?`,
    )
    .get(input.securityId, input.exDate, details);
  if (duplicate) {
    throw new StockSplitError('DUPLICATE_SPLIT', 'This split is already recorded', {
      exDate: input.exDate,
      ratio: details,
    });
  }

  const txRows = sqlite.prepare(SELECT_TRANSACTIONS).all(input.securityId, input.exDate) as TxRow[];
  const quoteRows = sqlite.prepare(SELECT_QUOTES).all(input.securityId, input.exDate) as QuoteRow[];

  const updateShares = sqlite.prepare(`UPDATE xact SET shares = ? WHERE uuid = ?`);
  const updateQuote = sqlite.prepare(
    `UPDATE price SET value = ?, open = ?, high = ?, low = ? WHERE security = ? AND tstamp = ?`,
  );
  const insertEvent = sqlite.prepare(
    `INSERT INTO security_event (security, date, type, details) VALUES (?, ?, 'STOCK_SPLIT', ?)`,
  );

  let txCount = 0; // native-ok
  let quoteCount = 0; // native-ok
  let eventId = 0; // native-ok

  try {
    sqlite.transaction(() => {
      if (input.changeTransactions) {
        for (const row of txRows) {
          const sharesNew = splitSharesDb(row.shares, ratio);
          if (sharesNew === row.shares) continue;
          updateShares.run(sharesNew, row.uuid);
          txCount++; // native-ok
        }
      }

      if (input.changeHistoricalQuotes) {
        for (const row of quoteRows) {
          const next = rescaleQuote(row, ratio);
          if (!next) continue;
          updateQuote.run(next.value, next.open, next.high, next.low, input.securityId, row.tstamp);
          quoteCount++; // native-ok
        }
      }

      eventId = Number(insertEvent.run(input.securityId, input.exDate, details).lastInsertRowid);

      // Every historical bar just moved, so the max-date row no longer agrees
      // with the stored latest quote. Re-derive it through the single sync
      // helper rather than writing latest_price by hand.
      if (input.changeHistoricalQuotes && quoteCount > 0) {
        syncLatestPriceFromGlobalMax(sqlite, input.securityId);
      }
    })();
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Rewriting share counts can make two previously-distinct imported rows
      // identical under the natural-key index. The transaction has already
      // rolled back, so nothing is half-applied. Dropping and recreating the
      // index around the rewrite would silently merge two real transactions.
      throw new StockSplitError(
        'SPLIT_DEDUPE_CONFLICT',
        'The rewrite would make two imported transactions identical',
        { securityId: input.securityId, exDate: input.exDate },
      );
    }
    throw err;
  }

  return { applied: { transactions: txCount, quotes: quoteCount }, eventId };
}
