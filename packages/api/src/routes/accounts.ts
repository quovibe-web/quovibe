import express, { Router, type Router as RouterType } from 'express';
import type { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { createAccountSchema, updateAccountSchema, updateAccountLogoSchema } from '@quovibe/shared';
import { accounts, accountAttributes } from '../db/schema';
import { getDb, getSqlite } from '../helpers/request';
import { convertTransactionFromDb, convertAmountFromDb } from '../services/unit-conversion';
import {
  getAccountBalance,
  getTransactionCount,
  getAccountHoldings,
  updateAccountFields,
  deleteAccountById,
  createAccount,
  AccountServiceError,
} from '../services/accounts.service';

export const accountsRouter: RouterType = Router();

const listAccounts: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const includeRetired = req.query.includeRetired === 'true';

  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      isRetired: accounts.isRetired,
      referenceAccountId: accounts.referenceAccountId,
      updatedAt: accounts.updatedAt,
      logoUrl: accountAttributes.value,
    })
    .from(accounts)
    .leftJoin(
      accountAttributes,
      and(
        eq(accountAttributes.accountId, accounts.id),
        eq(accountAttributes.typeId, 'logo'),
      ),
    )
    .where(includeRetired ? undefined : eq(accounts.isRetired, false));

  // For portfolios, resolve currency from the referenceAccount (portfolios have no own currency)
  const currencyById = new Map(rows.map(r => [r.id, r.currency]));
  res.json(rows.map(a => {
    const resolvedCurrency =
      a.type === 'portfolio' && a.referenceAccountId
        ? (currencyById.get(a.referenceAccountId) ?? null)
        : a.currency;
    return {
      ...a,
      currency: resolvedCurrency,
      logoUrl: a.logoUrl ?? null,
      balance: parseFloat(getAccountBalance(sqlite, a.id, a.type ?? null)),
      transactionCount: getTransactionCount(sqlite, a.id),
    };
  }));
};

const getAccount: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const rows = await db.select().from(accounts).where(eq(accounts.id, id));
  if (rows.length === 0) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const account = rows[0];
  let resolvedCurrency = account.currency;
  if (account.type === 'portfolio' && account.referenceAccountId) {
    const refRows = await db.select({ currency: accounts.currency }).from(accounts).where(eq(accounts.id, account.referenceAccountId));
    resolvedCurrency = refRows[0]?.currency ?? null;
  }
  res.json({ ...account, currency: resolvedCurrency, balance: parseFloat(getAccountBalance(sqlite, id, account.type ?? null)), transactionCount: getTransactionCount(sqlite, id) });
};

function normalizeTypeLocal(
  dbType: string,
  acctype: string | null,
  shares: number | null,
  crossAccId?: string | null,
  ownAccount?: string | null,
): string {
  if (dbType === 'TRANSFER_IN') {
    if (acctype === 'portfolio' || (shares != null && shares !== 0)) {
      if (crossAccId && crossAccId !== ownAccount) return 'SECURITY_TRANSFER';
      return 'DELIVERY_INBOUND';
    }
    return 'TRANSFER_BETWEEN_ACCOUNTS';
  }
  if (dbType === 'TRANSFER_OUT') {
    if (acctype === 'portfolio' || (shares != null && shares !== 0)) {
      // GAP-02: distinguish SECURITY_TRANSFER (cross-account) from DELIVERY_OUTBOUND (standalone)
      if (crossAccId && crossAccId !== ownAccount) return 'SECURITY_TRANSFER';
      return 'DELIVERY_OUTBOUND';
    }
    return 'TRANSFER_BETWEEN_ACCOUNTS';
  }
  if (dbType === 'DIVIDENDS') return 'DIVIDEND';
  return dbType;
}

const getAccountTransactions: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit as string || '50', 10));
  const offset = (page - 1) * limit;
  const id = req.params['id'] as string;

  const { total } = sqlite
    .prepare(
      `SELECT COUNT(*) as total FROM xact x WHERE x.account = ?`,
    )
    .get(id) as { total: number };

  const rows = sqlite
    .prepare(
      `SELECT x.*,
              (SELECT CASE WHEN ce.from_xact = x.uuid THEN ce.to_acc ELSE ce.from_acc END
               FROM xact_cross_entry ce
               WHERE ce.from_xact = x.uuid OR ce.to_xact = x.uuid
               LIMIT 1) as crossAccountId,
              (SELECT CASE WHEN ce.from_xact = x.uuid THEN 1 ELSE 0 END
               FROM xact_cross_entry ce
               WHERE ce.from_xact = x.uuid OR ce.to_xact = x.uuid
               LIMIT 1) as isFromXact
       FROM xact x
       WHERE x.account = ?
       ORDER BY x.date DESC
       LIMIT ? OFFSET ?`,
    )
    .all(id, limit, offset) as Record<string, unknown>[];

  const data = rows.map((r) => {
    const crossAccId = (r.crossAccountId as string | null) ?? null;
    const originalDbType = r.type as string;
    const normalizedType = normalizeTypeLocal(
      originalDbType,
      r.acctype as string | null,
      r.shares as number | null,
      crossAccId,
      r.account as string | null,
    );

    let direction: 'inbound' | 'outbound' | null = null;
    if (normalizedType === 'DELIVERY_INBOUND') {
      direction = 'inbound';
    } else if (normalizedType === 'DELIVERY_OUTBOUND') {
      direction = 'outbound';
    } else if (normalizedType === 'TRANSFER_BETWEEN_ACCOUNTS' || normalizedType === 'SECURITY_TRANSFER') {
      // Use original DB type for reliable direction: TRANSFER_IN = inbound, TRANSFER_OUT = outbound
      if (originalDbType === 'TRANSFER_IN') {
        direction = 'inbound';
      } else if (originalDbType === 'TRANSFER_OUT') {
        direction = 'outbound';
      } else {
        // ppxml2db rows use TRANSFER_BETWEEN_ACCOUNTS for both source and dest.
        // isFromXact=1 means this row is the source (outbound), 0 means destination (inbound).
        direction = (r.isFromXact === 1) ? 'outbound' : 'inbound';
      }
    }

    let converted = convertTransactionFromDb({
      amount: typeof r.amount === 'number' ? r.amount : null,
      shares: typeof r.shares === 'number' ? r.shares : null,
    });
    if (direction != null && (normalizedType === 'TRANSFER_BETWEEN_ACCOUNTS' || normalizedType === 'SECURITY_TRANSFER')) {
      converted = {
        amount: converted.amount != null
          ? (direction === 'inbound' ? converted.amount.abs() : converted.amount.abs().negated())
          : null,
        shares: converted.shares != null
          ? (direction === 'inbound' ? converted.shares.abs() : converted.shares.abs().negated())
          : null,
      };
    }

    return {
      ...r,
      type: normalizedType,
      currencyCode: r.currency as string,
      amount: converted.amount?.toNumber() ?? r.amount,
      shares: converted.shares?.toNumber() ?? r.shares,
      fees: convertAmountFromDb(r.fees as number | null).toNumber(),
      taxes: convertAmountFromDb(r.taxes as number | null).toNumber(),
      crossAccountId: crossAccId,
      direction,
    };
  });

  res.json({ data, page, limit, total });
};

const createAccountHandler: RequestHandler = async (req, res) => {
  const input = createAccountSchema.parse(req.body);
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = uuidv4();
  const dbType = input.type;
  // Portfolios don't own a currency — they inherit from referenceAccount
  const dbCurrency = dbType === 'portfolio' ? null : (input.currency ?? 'EUR');

  try {
    createAccount(sqlite, {
      id,
      name: input.name,
      dbType,
      dbCurrency,
      referenceAccountId: input.referenceAccountId ?? null,
    });
  } catch (err) {
    if (err instanceof AccountServiceError && err.code === 'DUPLICATE_NAME') {
      res.status(409).json({ error: 'DUPLICATE_NAME' });
      return;
    }
    throw err;
  }

  const rows = await db.select().from(accounts).where(eq(accounts.id, id));
  if (rows.length === 0) {
    res.status(500).json({ error: 'Failed to retrieve created account' });
    return;
  }
  res.status(201).json({ ...rows[0], balance: '0' });
};

const updateAccount: RequestHandler = async (req, res) => {
  const input = updateAccountSchema.parse(req.body);
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const existing = await db.select().from(accounts).where(eq(accounts.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const existingType = existing[0].type;
  const updateSet = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.type !== undefined && { type: input.type }),
    // Portfolios don't own a currency — ignore currency updates for portfolio type
    ...(input.currency !== undefined && existingType !== 'portfolio' && { currency: input.currency }),
    ...(input.referenceAccountId !== undefined && {
      referenceAccountId: input.referenceAccountId,
    }),
    ...(input.isRetired !== undefined && { isRetired: input.isRetired }),
    updatedAt: new Date().toISOString(),
  };
  // Only run the update if there are actual fields to change
  if (Object.keys(updateSet).length > 0) {
    try {
      await updateAccountFields(db, id, updateSet, sqlite);
    } catch (err) {
      if (err instanceof AccountServiceError && err.code === 'DUPLICATE_NAME') {
        res.status(409).json({ error: 'DUPLICATE_NAME' });
        return;
      }
      throw err;
    }
  }

  const updated = await db.select().from(accounts).where(eq(accounts.id, id));
  if (updated.length === 0) {
    res.status(404).json({ error: 'Account not found after update' });
    return;
  }
  const updatedAccount = updated[0];
  let updatedCurrency = updatedAccount.currency;
  if (updatedAccount.type === 'portfolio' && updatedAccount.referenceAccountId) {
    const refRows = await db.select({ currency: accounts.currency }).from(accounts).where(eq(accounts.id, updatedAccount.referenceAccountId));
    updatedCurrency = refRows[0]?.currency ?? null;
  }
  res.json({ ...updatedAccount, currency: updatedCurrency, balance: parseFloat(getAccountBalance(sqlite, id, updatedAccount.type ?? null)) });
};

const updateAccountLogo: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;
  const { logoUrl } = updateAccountLogoSchema.parse(req.body);

  if (logoUrl === null) {
    sqlite.prepare("DELETE FROM account_attr WHERE account = ? AND attr_uuid = 'logo'").run(id); // db-route-ok
  } else {
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM account_attr WHERE account = ? AND attr_uuid = 'logo'").run(id); // db-route-ok
      sqlite
        .prepare( // db-route-ok
          `INSERT INTO account_attr (account, attr_uuid, type, value, seq)
           VALUES (?, 'logo', 'string', ?, 0)`,
        )
        .run(id, logoUrl);
    })();
  }

  res.json({ ok: true });
};

const getAccountHoldingsHandler: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const rows = await db.select({ type: accounts.type }).from(accounts).where(eq(accounts.id, id));
  if (rows.length === 0) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (rows[0].type !== 'portfolio') {
    res.status(400).json({ error: 'ACCOUNT_NOT_PORTFOLIO' });
    return;
  }

  const result = getAccountHoldings(sqlite, id);
  res.json(result);
};

const deleteAccount: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const existing = await db.select().from(accounts).where(eq(accounts.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const txCount = getTransactionCount(sqlite, id);
  if (txCount > 0) {
    res.status(409).json({ error: 'ACCOUNT_HAS_TRANSACTIONS' });
    return;
  }

  // Check if any portfolio uses this as referenceAccount
  const refCount = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM account WHERE referenceAccount = ?')
    .get(id) as { cnt: number };
  if (refCount.cnt > 0) {
    res.status(409).json({ error: 'ACCOUNT_REFERENCED_BY_PORTFOLIO' });
    return;
  }

  deleteAccountById(sqlite, id);
  res.status(204).send();
};

accountsRouter.get('/', listAccounts);
accountsRouter.get('/:id/holdings', getAccountHoldingsHandler);
accountsRouter.get('/:id/transactions', getAccountTransactions);
accountsRouter.get('/:id', getAccount);
accountsRouter.post('/', createAccountHandler);
accountsRouter.put('/:id', updateAccount);
accountsRouter.put('/:id/logo', express.json({ limit: '2mb' }), updateAccountLogo);
accountsRouter.delete('/:id', deleteAccount);
