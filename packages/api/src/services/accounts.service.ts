import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { format } from 'date-fns';
import { getRateFromMap, convertToBase, type RateMap } from '@quovibe/engine';
import { safeDecimal } from './unit-conversion';
import { accounts } from '../db/schema';

type DrizzleDb = BetterSQLite3Database<Record<string, unknown>>;

export async function updateAccountFields(
  db: DrizzleDb,
  id: string,
  updateSet: Record<string, unknown>,
): Promise<void> {
  await db.update(accounts).set(updateSet).where(eq(accounts.id, id));
}

// ppxml2db stores prices and shares as 10^8 integers, amounts as 10^2 (hecto-units).
// All unit conversions for account balances live here, not in route handlers.

export function getDepositBalance(
  sqlite: BetterSqlite3.Database,
  accountId: string,
  fxContext?: { baseCurrency: string; accountCurrency: string; rateMap: RateMap },
): string {
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(
         CASE type
           WHEN 'DEPOSIT'          THEN amount
           WHEN 'REMOVAL'          THEN -amount
           WHEN 'BUY'              THEN -amount
           WHEN 'SELL'             THEN  amount
           WHEN 'DIVIDENDS'        THEN  amount
           WHEN 'INTEREST'         THEN  amount
           WHEN 'FEES'             THEN -amount
           WHEN 'FEES_REFUND'      THEN  amount
           WHEN 'TAXES'            THEN -amount
           WHEN 'TAX_REFUND'       THEN  amount
           WHEN 'INTEREST_CHARGE'  THEN -amount
           WHEN 'TRANSFER_IN'      THEN  amount
           WHEN 'TRANSFER_OUT'     THEN -amount
           ELSE 0
         END
       ), 0) as balance
       FROM xact
       WHERE account = ?`,
    )
    .get(accountId) as { balance: number };
  let total = safeDecimal(row.balance).div(100);
  if (fxContext && fxContext.accountCurrency !== fxContext.baseCurrency) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const rate = getRateFromMap(fxContext.rateMap, today);
    if (rate) total = convertToBase(total, rate);
  }
  return total.toString();
}

export function getSecuritiesBalance(
  sqlite: BetterSqlite3.Database,
  accountId: string,
  fxContext?: { baseCurrency: string; accountCurrency: string; rateMap: RateMap },
): string {
  // Computes market value using Decimal.js in application layer.
  // Never uses SQL REAL arithmetic for financial calculations (project rule).

  // Step 1: compute net shares per security using integer SQL arithmetic
  const positions = sqlite.prepare(`
    SELECT security,
      SUM(CASE
        WHEN type IN ('BUY', 'TRANSFER_IN')   THEN shares
        WHEN type IN ('SELL', 'TRANSFER_OUT')  THEN -shares
        ELSE 0
      END) as net_shares
    FROM xact
    WHERE account = ? AND shares IS NOT NULL AND shares > 0
    GROUP BY security
  `).all(accountId) as { security: string; net_shares: number }[];

  let total = new Decimal(0);

  for (const pos of positions) {
    if (pos.net_shares <= 0) continue;

    // Step 2: get latest price (latest_price preferred, then most recent historical close)
    const priceRow = sqlite.prepare(`
      SELECT COALESCE(
        (SELECT value FROM latest_price WHERE security = ?),
        (SELECT value FROM price p WHERE p.security = ? ORDER BY p.tstamp DESC LIMIT 1)
      ) AS value
    `).get(pos.security, pos.security) as { value: number | null };

    if (priceRow?.value != null) {
      // Step 3: divide integer ppxml2db units using Decimal — no REAL arithmetic
      const shares = new Decimal(pos.net_shares).div('100000000');
      const price = new Decimal(priceRow.value).div('100000000');
      total = total.plus(shares.times(price));
    }
  }

  if (fxContext && fxContext.accountCurrency !== fxContext.baseCurrency) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const rate = getRateFromMap(fxContext.rateMap, today);
    if (rate) total = convertToBase(total, rate);
  }
  return total.toString();
}

export function getAccountBalance(
  sqlite: BetterSqlite3.Database,
  accountId: string,
  accountType: string | null,
): string {
  return accountType === 'portfolio'
    ? getSecuritiesBalance(sqlite, accountId)
    : getDepositBalance(sqlite, accountId);
}

export interface Holding {
  securityId: string;
  securityName: string;
  isin: string | null;
  shares: string;
  currentPrice: string;
  value: string;
  avgCost: string;
  profitLoss: string;
  returnPct: string;
}

export interface AccountHoldings {
  holdings: Holding[];
  totalValue: string;
}

export function getAccountHoldings(
  sqlite: BetterSqlite3.Database,
  accountId: string,
): AccountHoldings {
  // Step 1: compute net shares per security (only positions with net shares > 0)
  const positions = sqlite.prepare(`
    SELECT security,
      SUM(CASE
        WHEN type IN ('BUY', 'TRANSFER_IN')   THEN shares
        WHEN type IN ('SELL', 'TRANSFER_OUT')  THEN -shares
        ELSE 0
      END) as net_shares
    FROM xact
    WHERE account = ? AND shares IS NOT NULL AND shares > 0
    GROUP BY security
    HAVING net_shares > 0
  `).all(accountId) as { security: string; net_shares: number }[];

  const holdings: Holding[] = [];
  let totalValue = new Decimal(0);

  for (const pos of positions) {
    // Step 2: get security name and ISIN
    const secRow = sqlite
      .prepare('SELECT name, isin FROM security WHERE uuid = ?')
      .get(pos.security) as { name: string; isin: string | null } | undefined;

    // Step 3: get latest price (latest_price preferred, then most recent historical close)
    const priceRow = sqlite.prepare(`
      SELECT COALESCE(
        (SELECT value FROM latest_price WHERE security = ?),
        (SELECT value FROM price p WHERE p.security = ? ORDER BY p.tstamp DESC LIMIT 1)
      ) AS value
    `).get(pos.security, pos.security) as { value: number | null };

    const currentShares = new Decimal(pos.net_shares).div('100000000');
    const currentPrice = priceRow?.value != null
      ? new Decimal(priceRow.value).div('100000000')
      : new Decimal(0);
    const currentValue = currentShares.times(currentPrice);

    // Step 4: compute avg cost from BUY transactions only.
    // Subtract fees and taxes so that costBasis reflects gross acquisition cost (shares × price),
    // not the net settlement amount debited from cash.
    const costRow = sqlite.prepare(`
      SELECT
        COALESCE(SUM(shares), 0) as total_shares,
        COALESCE(SUM(amount - COALESCE(fees, 0) - COALESCE(taxes, 0)), 0) as total_cost
      FROM xact
      WHERE account = ? AND security = ? AND type = 'BUY'
    `).get(accountId, pos.security) as { total_shares: number; total_cost: number };

    const totalAcquiredShares = new Decimal(costRow.total_shares).div('100000000');
    // total_cost is already the sum of BUY gross costs (fees/taxes excluded, all in hecto-units)
    const totalCost = new Decimal(costRow.total_cost).div(100);
    const avgCost = totalAcquiredShares.gt(0)
      ? totalCost.div(totalAcquiredShares)
      : new Decimal(0);

    // Step 5: compute P/L.
    // Use totalCost directly as costBasis so that transferred-in shares (which have no BUY cost)
    // do not inflate the basis via avgCost × currentShares.
    const costBasis = totalCost;
    const profitLoss = currentValue.minus(costBasis);
    const returnPct = costBasis.gt(0) ? profitLoss.div(costBasis) : new Decimal(0);

    totalValue = totalValue.plus(currentValue);

    holdings.push({
      securityId: pos.security,
      securityName: secRow?.name ?? '',
      isin: secRow?.isin ?? null,
      shares: currentShares.toString(),
      currentPrice: currentPrice.toString(),
      value: currentValue.toString(),
      avgCost: avgCost.toString(),
      profitLoss: profitLoss.toString(),
      returnPct: returnPct.toString(),
    });
  }

  return { holdings, totalValue: totalValue.toString() };
}

export function getTransactionCount(sqlite: BetterSqlite3.Database, accountId: string): number {
  const row = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM xact WHERE account = ?')
    .get(accountId) as { cnt: number };
  return row.cnt;
}

/**
 * Deletes an account and all dependent rows (attrs, taxonomy assignments + data) in a single transaction.
 */
export function deleteAccountById(
  sqlite: BetterSqlite3.Database,
  id: string,
): void {
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM account_attr WHERE account = ?').run(id);
    sqlite.prepare(
      `DELETE FROM taxonomy_assignment_data WHERE assignment IN
       (SELECT _id FROM taxonomy_assignment WHERE item = ? AND item_type = 'account')`,
    ).run(id);
    sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE item = ? AND item_type = 'account'`).run(id);
    sqlite.prepare('DELETE FROM account WHERE uuid = ?').run(id);
  })();
}
