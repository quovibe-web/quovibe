import { Router, type Router as RouterType } from 'express';
import type { RequestHandler } from 'express';
import { createTransactionSchema, AccountType, isTransactionTypeAllowed, CASH_ONLY_ROUTED_TYPES, TransactionType } from '@quovibe/shared';
import * as transactionService from '../services/transaction.service';
import { getDb, getSqlite } from '../helpers/request';
import { convertTransactionFromDb, convertAmountFromDb } from '../services/unit-conversion';

function mapDbAccountType(dbType: string): AccountType {
  return dbType === 'portfolio' ? AccountType.SECURITIES : AccountType.DEPOSIT;
}

// Maps ppxml2db DB type strings back to canonical quovibe enum names.
// acctype, shares, crossAccId and ownAccount are used to disambiguate TRANSFER_OUT rows.
// crossAccId: the to_acc from xact_cross_entry; ownAccount: the row's account field.
function normalizeType(
  dbType: string,
  acctype: string | null,
  shares: number | null,
  crossAccId?: string | null,
  ownAccount?: string | null,
): string {
  if (dbType === 'TRANSFER_IN') {
    // portfolio acctype = DELIVERY_INBOUND (shares arrive from outside the portfolio)
    // account acctype = destination side of TRANSFER_BETWEEN_ACCOUNTS.
    //   In the current list endpoint these rows are already excluded by the to_xact universal filter,
    //   so this branch is forward-looking (needed for a future /transactions/:id endpoint).
    //   The operative guard for the current list is typeFilterCondition's acctype='portfolio' check.
    if (acctype === 'portfolio') return 'DELIVERY_INBOUND';
    return 'TRANSFER_BETWEEN_ACCOUNTS';
  }
  if (dbType === 'TRANSFER_OUT') {
    if (acctype === 'portfolio' || (shares != null && shares !== 0)) {
      // GAP-02: distinguish SECURITY_TRANSFER (cross-account portfolio transfer) from
      // standalone DELIVERY_OUTBOUND. If there is a genuine cross_entry to a different
      // account, this is a SECURITY_TRANSFER. For standalone DELIVERY_OUTBOUND, either
      // crossAccId is null (post-GAP-05) or equals ownAccount (pre-GAP-05 self-referential).
      if (crossAccId && crossAccId !== ownAccount) return 'SECURITY_TRANSFER';
      return 'DELIVERY_OUTBOUND';
    }
    return 'TRANSFER_BETWEEN_ACCOUNTS';
  }
  if (dbType === 'DIVIDENDS') return 'DIVIDEND';
  return dbType;
}

// Inverse of normalizeType: maps a frontend TransactionType enum value to the SQL
// condition fragment that matches the corresponding rows in ppxml2db.
// Returns { sql, params } to be injected into the WHERE clause.
function typeFilterCondition(enumType: string): { sql: string; params: unknown[] } {
  switch (enumType) {
    case 'DIVIDEND':
      return { sql: 'x.type = ?', params: ['DIVIDENDS'] };
    case 'DELIVERY_INBOUND':
      // Guard: only portfolio-side TRANSFER_IN rows are DELIVERY_INBOUND.
      // After GAP-01 fix, deposit-side TRANSFER_IN rows exist as transfer destinations.
      return {
        sql: "x.type = 'TRANSFER_IN' AND x.acctype = 'portfolio'",
        params: [],
      };
    case 'SECURITY_TRANSFER':
      // GAP-02: TRANSFER_OUT on portfolio with shares AND a genuine cross_entry to another account.
      // This distinguishes SECURITY_TRANSFER from standalone DELIVERY_OUTBOUND.
      return {
        sql: "x.type = 'TRANSFER_OUT' AND (x.acctype = 'portfolio' OR (x.shares IS NOT NULL AND x.shares != 0)) AND x.uuid IN (SELECT from_xact FROM xact_cross_entry WHERE from_xact != to_xact)",
        params: [],
      };
    case 'DELIVERY_OUTBOUND':
      // TRANSFER_OUT rows on portfolio/shares but WITHOUT a genuine cross_entry (standalone delivery)
      return {
        sql: "x.type = 'TRANSFER_OUT' AND (x.acctype = 'portfolio' OR (x.shares IS NOT NULL AND x.shares != 0)) AND x.uuid NOT IN (SELECT from_xact FROM xact_cross_entry WHERE from_xact != to_xact)",
        params: [],
      };
    case 'TRANSFER_BETWEEN_ACCOUNTS':
      // TRANSFER_OUT rows that are deposit-to-deposit (no portfolio, no shares)
      return {
        sql: "x.type = 'TRANSFER_OUT' AND x.acctype != 'portfolio' AND (x.shares IS NULL OR x.shares = 0)",
        params: [],
      };
    default:
      return { sql: 'x.type = ?', params: [enumType] };
  }
}

// Type-allowed guard shared by POST and PUT handlers.
//
// BUG-04 (Pass 1): previously, any `accountId` pointing to a portfolio bypassed
// this 422 guard — the bypass existed so that cash-only types (DEPOSIT,
// DIVIDEND, …) post against a portfolio would be auto-routed to its linked
// deposit (`referenceAccount`) by `resolveAccountTarget` in the service. But
// TRANSFER_BETWEEN_ACCOUNTS is not cash-only: with the blanket bypass, a
// portfolio source slipped through and persisted as the transfer's cash
// holder. Narrow the bypass to only the types the service actually routes
// (`CASH_ONLY_ROUTED_TYPES`), and symmetrically validate `crossAccountId` so
// a portfolio destination is rejected too.
//
// Returns an error message on rejection, or `null` when the input is allowed.
function enforceAccountTypeGuards(
  sqlite: ReturnType<typeof getSqlite>,
  input: ReturnType<typeof createTransactionSchema.parse>,
): string | null {
  if (input.accountId) {
    const acct = sqlite
      .prepare('SELECT type FROM account WHERE uuid = ?')
      .get(input.accountId) as { type: string } | undefined;
    if (acct) {
      const accountType = mapDbAccountType(acct.type);
      const isPortfolioRouting =
        acct.type === 'portfolio' && CASH_ONLY_ROUTED_TYPES.has(input.type);
      if (!isPortfolioRouting && !isTransactionTypeAllowed(accountType, input.type)) {
        return 'TRANSACTION_TYPE_NOT_ALLOWED_FOR_SOURCE';
      }
    }
  }

  // Symmetric check: for transfer types the destination must also be a valid
  // holder of the transaction — a TRANSFER_BETWEEN_ACCOUNTS into a portfolio
  // is just as broken as one out of a portfolio.
  if (
    input.crossAccountId &&
    (input.type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS ||
      input.type === TransactionType.SECURITY_TRANSFER)
  ) {
    const crossAcct = sqlite
      .prepare('SELECT type FROM account WHERE uuid = ?')
      .get(input.crossAccountId) as { type: string } | undefined;
    if (crossAcct) {
      const crossAccountType = mapDbAccountType(crossAcct.type);
      if (!isTransactionTypeAllowed(crossAccountType, input.type)) {
        return 'TRANSACTION_TYPE_NOT_ALLOWED_FOR_DESTINATION';
      }
    }
  }

  return null;
}

export const transactionsRouter: RouterType = Router();

const listTransactions: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string || '50', 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (req.query.account) {
    // Standalone transactions are found via x.account = ?
    // BUY/SELL and transfer pairs are found via cross_entry (which links both accounts to the source row)
    conditions.push(
      '(x.account = ? OR x.uuid IN (SELECT from_xact FROM xact_cross_entry WHERE from_acc = ? OR to_acc = ?))',
    );
    params.push(req.query.account, req.query.account, req.query.account);
  }
  if (req.query.security) {
    conditions.push('x.security = ?');
    params.push(req.query.security);
  }
  if (req.query.type) {
    const { sql: typeSql, params: typeParams } = typeFilterCondition(req.query.type as string);
    conditions.push(typeSql);
    params.push(...typeParams);
  }
  if (req.query.from) {
    conditions.push('x.date >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    // Append T23:59:59 so that datetime values on the boundary date are included.
    // Without this, "2026-03-31T08:42" > "2026-03-31" in SQLite string comparison.
    conditions.push('x.date <= ?');
    params.push(req.query.to + 'T23:59:59');
  }
  // Free-text search: compound OR across all display-relevant columns.
  // x.type matches raw ppxml2db enum (DIVIDENDS, TRANSFER_OUT, etc.), not normalized names —
  // this is intentional (matches PP behavior where search hits raw DB values).
  if (req.query.search) {
    const searchTerm = String(req.query.search);
    conditions.push(`(
      x.date LIKE '%' || ? || '%'
      OR x.type LIKE '%' || ? || '%' COLLATE NOCASE
      OR COALESCE(s.name, '') LIKE '%' || ? || '%' COLLATE NOCASE
      OR COALESCE(s.isin, '') LIKE '%' || ? || '%' COLLATE NOCASE
      OR COALESCE(s.tickerSymbol, '') LIKE '%' || ? || '%' COLLATE NOCASE
      OR COALESCE(s.wkn, '') LIKE '%' || ? || '%' COLLATE NOCASE
      OR COALESCE(a.name, '') LIKE '%' || ? || '%' COLLATE NOCASE
      OR COALESCE(x.note, '') LIKE '%' || ? || '%' COLLATE NOCASE
      OR printf('%.2f', COALESCE(x.amount, 0) / 100.0) LIKE '%' || ? || '%'
      OR printf('%.4f', COALESCE(x.shares, 0) / 1e8) LIKE '%' || ? || '%' -- conversion-ok: SQL printf for search display only
      OR COALESCE(oa.name, '') LIKE '%' || ? || '%' COLLATE NOCASE
    )`);
    for (let i = 0; i < 11; i++) params.push(searchTerm);
  }

  // Universal: exclude the "to_xact" side of all genuine dual-entry cross-entries
  conditions.push('x.uuid NOT IN (SELECT to_xact FROM xact_cross_entry WHERE from_xact != to_xact)');

  const where = conditions.join(' AND ');

  const countRow = sqlite
    .prepare(
      `SELECT COUNT(DISTINCT x.uuid) as total
       FROM xact x
       LEFT JOIN security s ON s.uuid = x.security
       LEFT JOIN account a ON a.uuid = x.account
       LEFT JOIN xact_cross_entry ce2 ON ce2.from_xact = x.uuid AND ce2.from_xact != ce2.to_xact
       LEFT JOIN account oa ON oa.uuid = ce2.to_acc
       WHERE ${where}`,
    )
    .get(...params) as { total: number };
  const total = countRow.total;

  const rows = sqlite
    .prepare(
      `SELECT x.*, s.name as securityName, a.name as accountName,
              (SELECT ce.to_acc FROM xact_cross_entry ce WHERE ce.from_xact = x.uuid LIMIT 1) as crossAccountId,
              GROUP_CONCAT(u.type || ':' || u.amount, '|') as units_raw
       FROM xact x
       LEFT JOIN security s ON s.uuid = x.security
       LEFT JOIN account a ON a.uuid = x.account
       LEFT JOIN xact_unit u ON u.xact = x.uuid
       LEFT JOIN xact_cross_entry ce2 ON ce2.from_xact = x.uuid AND ce2.from_xact != ce2.to_xact
       LEFT JOIN account oa ON oa.uuid = ce2.to_acc
       WHERE ${where}
       GROUP BY x.uuid
       ORDER BY x.date DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  const viewingAccountId = req.query.account as string | undefined;

  const data = rows.map(r => {
    const crossAccId = (r.crossAccountId as string | null) ?? null;
    const normalizedType = normalizeType(
      r.type as string,
      r.acctype as string | null,
      r.shares as number | null,
      crossAccId,
      r.account as string | null,
    );

    // Compute direction relative to the viewing account
    let direction: 'inbound' | 'outbound' | null = null;
    if (normalizedType === 'DELIVERY_INBOUND') {
      direction = 'inbound';
    } else if (normalizedType === 'DELIVERY_OUTBOUND') {
      direction = 'outbound';
    } else if (viewingAccountId && (normalizedType === 'TRANSFER_BETWEEN_ACCOUNTS' || normalizedType === 'SECURITY_TRANSFER')) {
      // crossAccId = to_acc (destination). If destination == viewing account → we are the receiver
      direction = crossAccId === viewingAccountId ? 'inbound' : 'outbound';
    }

    // Normalize sign based on direction (abs-based) to handle both:
    // - createTransaction rows: source is negative (API-created)
    // - ppxml2db rows: both source and dest are positive (imported from XML)
    // When direction is null (no account filter), always use abs() so the global
    // list shows a consistent positive amount regardless of data origin.
    let converted = convertTransactionFromDb({
      amount: r.amount as number | null,
      shares: r.shares as number | null,
    });
    if (normalizedType === 'TRANSFER_BETWEEN_ACCOUNTS' || normalizedType === 'SECURITY_TRANSFER') {
      converted = {
        amount: converted.amount != null
          ? (direction === 'inbound' ? converted.amount.abs() : direction === 'outbound' ? converted.amount.abs().negated() : converted.amount.abs())
          : null,
        shares: converted.shares != null
          ? (direction === 'inbound' ? converted.shares.abs() : direction === 'outbound' ? converted.shares.abs().negated() : converted.shares.abs())
          : null,
      };
    }

    return {
      ...r,
      date: r.date,
      type: normalizedType,
      currencyCode: r.currency as string,
      amount: converted.amount?.toNumber() ?? null,
      shares: converted.shares?.toNumber() ?? null,
      fees: convertAmountFromDb(r.fees as number | null).toNumber(),
      taxes: convertAmountFromDb(r.taxes as number | null).toNumber(),
      direction,
      crossAccountId: crossAccId,
      units_raw: undefined,
      units: r.units_raw
      ? String(r.units_raw)
          .split('|')
          .map(part => {
            const colonIdx = part.indexOf(':');
            const type = part.slice(0, colonIdx);
            const rawAmt = parseFloat(part.slice(colonIdx + 1));
            return {
              type,
              amount: convertAmountFromDb(rawAmt).toNumber(),
            };
          })
      : [],
    };
  });

  res.json({ data, page, limit, total });
};

const createTransaction: RequestHandler = (req, res) => {
  const input = createTransactionSchema.parse(req.body);
  const sqlite = getSqlite(req);
  const db = getDb(req);

  const guardResult = enforceAccountTypeGuards(sqlite, input);
  if (guardResult) {
    res.status(422).json({ error: guardResult });
    return;
  }

  const id = transactionService.createTransaction(db, sqlite, input);
  const row = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  const created = convertTransactionFromDb({
    amount: (row?.amount as number | null) ?? null,
    shares: (row?.shares as number | null) ?? null,
  });
  res.status(201).json({
    ...row,
    currencyCode: (row?.currency as string) ?? null,
    amount: created.amount?.toNumber() ?? null,
    shares: created.shares?.toNumber() ?? null,
    fees: convertAmountFromDb(row?.fees as number | null).toNumber(),
    taxes: convertAmountFromDb(row?.taxes as number | null).toNumber(),
  });
};

const updateTransaction: RequestHandler = (req, res) => {
  const input = createTransactionSchema.parse(req.body);
  const sqlite = getSqlite(req);
  const db = getDb(req);
  const id = req.params['id'] as string;

  const existing = sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  const guardResult = enforceAccountTypeGuards(sqlite, input);
  if (guardResult) {
    res.status(422).json({ error: guardResult });
    return;
  }

  transactionService.updateTransaction(db, sqlite, id, input);
  const row = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  const updated = convertTransactionFromDb({
    amount: (row?.amount as number | null) ?? null,
    shares: (row?.shares as number | null) ?? null,
  });
  res.json({
    ...row,
    currencyCode: (row?.currency as string) ?? null,
    amount: updated.amount?.toNumber() ?? null,
    shares: updated.shares?.toNumber() ?? null,
    fees: convertAmountFromDb(row?.fees as number | null).toNumber(),
    taxes: convertAmountFromDb(row?.taxes as number | null).toNumber(),
  });
};

const deleteTransaction: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const db = getDb(req);
  const id = req.params['id'] as string;

  const existing = sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  transactionService.deleteTransaction(db, sqlite, id);
  res.status(204).send();
};

const firstDate: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const row = sqlite
    .prepare(`SELECT MIN(date) as firstDate FROM xact WHERE date IS NOT NULL`)
    .get() as { firstDate: string | null };
  if (!row.firstDate) { res.json({ date: null }); return; }
  const d = new Date(row.firstDate.slice(0, 10));
  d.setDate(d.getDate() - 1);
  res.json({ date: d.toISOString().slice(0, 10) });
};

const getTransaction: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const row = sqlite
    .prepare(
      `SELECT x.*, s.name as securityName, a.name as accountName,
              (SELECT ce.to_acc FROM xact_cross_entry ce WHERE ce.from_xact = x.uuid LIMIT 1) as crossAccountId
       FROM xact x
       LEFT JOIN security s ON s.uuid = x.security
       LEFT JOIN account a ON a.uuid = x.account
       WHERE x.uuid = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  const crossAccId = (row.crossAccountId as string | null) ?? null;
  const normalizedType = normalizeType(
    row.type as string,
    row.acctype as string | null,
    row.shares as number | null,
    crossAccId,
    row.account as string | null,
  );

  const converted = convertTransactionFromDb({
    amount: row.amount as number | null,
    shares: row.shares as number | null,
  });

  // Fetch xact_unit rows
  const unitRows = sqlite
    .prepare(
      'SELECT type, amount, currency, forex_amount, forex_currency, exchangeRate FROM xact_unit WHERE xact = ?',
    )
    .all(id) as {
    type: string;
    amount: number;
    currency: string | null;
    forex_amount: number | null;
    forex_currency: string | null;
    exchangeRate: string | null;
  }[];

  const units = unitRows.map(u => ({
    type: u.type,
    amount: convertAmountFromDb(u.amount).toNumber(),
    currency: u.currency,
    forexAmount: u.forex_amount != null ? convertAmountFromDb(u.forex_amount).toNumber() : null,
    forexCurrency: u.forex_currency,
    exchangeRate: u.exchangeRate,
  }));

  res.json({
    ...row,
    type: normalizedType,
    currencyCode: row.currency as string,
    amount: converted.amount?.toNumber() ?? null,
    shares: converted.shares?.toNumber() ?? null,
    fees: convertAmountFromDb(row.fees as number | null).toNumber(),
    taxes: convertAmountFromDb(row.taxes as number | null).toNumber(),
    crossAccountId: crossAccId,
    units,
  });
};

transactionsRouter.get('/first-date', firstDate);
transactionsRouter.get('/', listTransactions);
transactionsRouter.get('/:id', getTransaction);
transactionsRouter.post('/', createTransaction);
transactionsRouter.put('/:id', updateTransaction);
transactionsRouter.delete('/:id', deleteTransaction);
