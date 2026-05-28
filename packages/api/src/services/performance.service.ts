import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import {
  differenceInCalendarDays,
  parseISO,
  format,
  eachDayOfInterval,
  subDays,
} from 'date-fns';
import { TransactionType, CostMethod, isTradingDay } from '@quovibe/shared';
import type {
  TransactionWithUnits, TransactionUnit, Cashflow,
  CapitalGainItem, RealizedGainItem, DividendItem,
  FeeItem, TaxItem, CashCurrencyGainItem, PntItem,
  CapitalGainsBreakdown, RealizedGainsBreakdown, EarningsBreakdown,
  FeesBreakdown, TaxesBreakdown, CashCurrencyGainsBreakdown, PntBreakdown,
  OpenPositionPnLBreakdown,
} from '@quovibe/shared';
import type { CostTransaction, FIFOResult } from '@quovibe/engine';
import {
  resolvePortfolioCashflows,
  resolveSecurityCashflows,
  buildDailySnapshotsWithCarry,
  carryForwardPrices,
  computeTTWROR,
  computeIRR,
  computePurchaseValue,
  computePeriodRelativeGains,
  getGrossAmount,
  getFees,
  getTaxes,
  getSecurityCurrencyGross,
  aggregateMonthlyReturns,

  computeAbsolutePerformance,
  computeMaxDrawdown,
  computeVolatility,
  computeSharpeRatio,
  computeFIFO,
  computeMovingAverage,
  decomposeRealized,
  decomposeUnrealized,
} from '@quovibe/engine';
import { safeDecimal, convertAmountFromDb } from './unit-conversion';
import { inheritTransferCostBasis } from './perf-helpers/transfer-cost';
import { buildRateMap, getRate } from './fx.service';
import {
  getRateFromMap,
  convertToBase,
  computeCashCurrencyGain,
  type RateMap,
} from '@quovibe/engine';
import { getPortfolioBaseCurrency } from './portfolio-base.service';

// ─── ppxml2db type normalization ──────────────────────────────────────────────
// ppxml2db uses different type strings than quovibe's TransactionType enum

const PPXML2DB_TYPE_MAP: Record<string, string> = {
  DIVIDENDS: 'DIVIDEND',
  TRANSFER_IN: 'DELIVERY_INBOUND',
  TRANSFER_OUT: 'DELIVERY_OUTBOUND',
};

function normalizeXactType(type: string): TransactionType {
  return ((PPXML2DB_TYPE_MAP[type] ?? type) as TransactionType);
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface RawXactRow {
  uuid: string;
  type: string;
  date: string;
  currency: string | null;
  amount: number | null;
  shares: number | null;
  note: string | null;
  security: string | null;
  account: string;
  source: string | null;
  updatedAt: string | null;
  units_raw: string | null;
  ceType: string | null;
}

// Extended type used internally in this module to carry accountId through the pipeline.
// Extends TransactionWithUnits so all downstream consumers remain compatible.
export interface PerfTransaction extends TransactionWithUnits {
  accountId: string;
  /** For TRANSFER_BETWEEN_ACCOUNTS only: true if this is the outbound (source) side. */
  isTransferOut?: boolean;
  /** For SECURITY_TRANSFER only: direction from the DB type (TRANSFER_OUT → 'OUT', TRANSFER_IN → 'IN'). */
  transferDirection?: 'IN' | 'OUT';
}

function parseRawRow(row: RawXactRow): PerfTransaction {
  // units_raw layout (per fetchAllTransactions SQL):
  //   "type:amount_hecto:currency:forex_amount_hecto:forex_currency:exchangeRate"
  // Empty positional fields are encoded as empty string; GROUP_CONCAT preserves
  // them because there's an explicit ':' between every position. Round-tripping
  // fxAmount/fxCurrencyCode/fxRate is load-bearing for per-security-native cost
  // basis (see docs/architecture/multi-currency.md).
  const units: TransactionUnit[] = row.units_raw
    ? row.units_raw.split('|').map((part) => {
        const fields = part.split(':');
        const type = fields[0] as TransactionUnit['type'];
        const amount = parseFloat(fields[1] ?? '0') / 100; // hecto-units → currency
        const currencyCode = fields[2] && fields[2] !== '' ? fields[2] : null;
        const fxAmountRaw = fields[3];
        const fxAmount =
          fxAmountRaw && fxAmountRaw !== '' ? parseFloat(fxAmountRaw) / 100 : null;
        const fxCurrencyCode = fields[4] && fields[4] !== '' ? fields[4] : null;
        const fxRateRaw = fields[5];
        const fxRate = fxRateRaw && fxRateRaw !== '' ? parseFloat(fxRateRaw) : null;
        return {
          id: '',
          transactionId: row.uuid,
          type,
          amount,
          currencyCode,
          fxAmount,
          fxCurrencyCode,
          fxRate,
        };
      })
    : [];

  // Disambiguate TRANSFER_OUT/IN: ppxml2db uses them for both DELIVERY_OUTBOUND/INBOUND,
  // TRANSFER_BETWEEN_ACCOUNTS, and SECURITY_TRANSFER.
  // - Security transfers (portfolio-transfer cross-entry): shares move between security accounts,
  //   NOT a portfolio-level cashflow.
  // - Deliveries: shares > 0, no portfolio-transfer cross-entry.
  // - Account transfers: shares = 0/null.
  let normalizedType = normalizeXactType(row.type);
  let isTransferOut: boolean | undefined;
  let transferDirection: 'IN' | 'OUT' | undefined;

  if (row.ceType === 'portfolio-transfer') {
    // Security transfer: shares move between security accounts within the portfolio.
    // NOT a portfolio-level cashflow — must NOT be mapped to DELIVERY_*.
    normalizedType = TransactionType.SECURITY_TRANSFER;
    // Raw DB type preserves direction: TRANSFER_OUT = source leg, TRANSFER_IN = dest leg.
    transferDirection = row.type === 'TRANSFER_OUT' ? 'OUT' : 'IN';
  } else if (normalizedType === TransactionType.DELIVERY_OUTBOUND && (row.shares == null || row.shares === 0)) {
    isTransferOut = true;
    normalizedType = TransactionType.TRANSFER_BETWEEN_ACCOUNTS;
  } else if (normalizedType === TransactionType.DELIVERY_INBOUND && (row.shares == null || row.shares === 0)) {
    isTransferOut = false;
    normalizedType = TransactionType.TRANSFER_BETWEEN_ACCOUNTS;
  }

  return {
    id: row.uuid,
    type: normalizedType,
    date: row.date.slice(0, 10), // normalize 'yyyy-MM-ddTHH:mm' → 'yyyy-MM-dd'
    currencyCode: row.currency,
    amount: row.amount != null ? row.amount / 100 : null, // hecto-units → EUR
    shares: row.shares,
    note: row.note,
    securityId: row.security,
    source: row.source,
    updatedAt: row.updatedAt,
    units,
    accountId: row.account,
    isTransferOut,
    transferDirection,
  };
}

// ─── Per-security currency projection (multi-currency.md) ───────────────────

/**
 * Returns a copy of `secTxs` where every transaction's `amount` and every
 * FEE/TAX `units[].amount` is denominated in `securityCurrency`. Used to
 * keep per-security FIFO/MA, TTWROR cashflows, and earnings/fees sums in a
 * single currency.
 *
 * Per docs/architecture/multi-currency.md, the resolution priority is:
 *
 *   1. Same-currency transaction (tx.currencyCode === securityCurrency) →
 *      pass through unchanged.
 *   2. Any FX-decorated unit (`GROSS_VALUE` or `FOREX`) with
 *      fxCurrencyCode === securityCurrency and non-null fxAmount → use
 *      fxAmount as the security-currency gross; convert FEE/TAX units
 *      via their own fxAmount when present, else via the parent rate.
 *      Read-tolerant across both writers: ppxml2db emits PP's
 *      `GROSS_VALUE` from XML; transaction.service.ts emits `FOREX`.
 *      Same payload shape.
 *   3. Otherwise → fall back to vf_exchange_rate at the trade date for
 *      the (depositCurrency, securityCurrency) pair.
 *   4. Unresolved → pass through unchanged. The caller logs a warning;
 *      the resulting per-security perf will mix currencies until the
 *      user supplies a rate (manual rate-entry surface is a follow-up).
 *
 * Currency-blind transaction types (BUY/SELL cash-side with shares=0,
 * standalone FEES/TAXES, INTEREST, REMOVAL, etc.) are passed through
 * unchanged — they are already accounted on the deposit-currency side
 * and are NOT consumed by per-security FIFO/cashflow paths.
 */
function projectTransactionsToSecurityCurrency(
  sqlite: BetterSqlite3.Database,
  secTxs: PerfTransaction[],
  securityCurrency: string,
): PerfTransaction[] {
  return secTxs.map((tx) => {
    if (tx.currencyCode === securityCurrency || tx.amount == null) {
      return tx;
    }

    const fxUnit = tx.units.find(
      (u) =>
        (u.type === 'GROSS_VALUE' || u.type === 'FOREX') &&
        u.fxCurrencyCode === securityCurrency &&
        u.fxAmount != null,
    );

    let secGross: Decimal | null = null;
    let resolvedRate: Decimal | null = null;

    if (fxUnit && fxUnit.fxAmount != null) {
      secGross = new Decimal(fxUnit.fxAmount);
      resolvedRate =
        fxUnit.fxRate != null ? new Decimal(fxUnit.fxRate) : null;
    } else if (tx.currencyCode != null) {
      const rate = getRate(sqlite, tx.currencyCode, securityCurrency, tx.date);
      if (rate) {
        const depGross = getGrossAmount(tx);
        secGross = depGross.times(rate);
        resolvedRate = rate;
      }
    }

    if (secGross == null) {
      return tx;
    }

    // Convert FEE/TAX unit amounts: prefer the unit's own fxAmount when it
    // targets securityCurrency, else multiply by the resolved parent rate.
    let secFees = new Decimal(0);
    let secTaxes = new Decimal(0);
    const projectedUnits: TransactionUnit[] = tx.units.map((u) => {
      if (u.type !== 'FEE' && u.type !== 'TAX') return u;
      let secAmt: number;
      if (u.fxCurrencyCode === securityCurrency && u.fxAmount != null) {
        secAmt = u.fxAmount;
      } else if (resolvedRate) {
        secAmt = new Decimal(u.amount).times(resolvedRate).toNumber();
      } else {
        secAmt = u.amount; // unresolvable; keep deposit-ccy as least-bad
      }
      if (u.type === 'FEE') secFees = secFees.plus(secAmt);
      else secTaxes = secTaxes.plus(secAmt);
      return { ...u, amount: secAmt };
    });

    // Re-pack tx.amount using ppxml2db's amount = gross ± fees ± taxes
    // convention. OUTFLOW types: amount = gross + fees + taxes. Others:
    // amount = gross − fees − taxes.
    const isOutflow =
      tx.type === TransactionType.BUY ||
      tx.type === TransactionType.DELIVERY_INBOUND ||
      tx.type === TransactionType.INTEREST_CHARGE ||
      tx.type === TransactionType.FEES ||
      tx.type === TransactionType.TAXES;
    const newAmount = isOutflow
      ? secGross.plus(secFees).plus(secTaxes)
      : secGross.minus(secFees).minus(secTaxes);

    return {
      ...tx,
      currencyCode: securityCurrency,
      amount: newAmount.toNumber(),
      units: projectedUnits,
    };
  });
}

// ─── Portfolio-base currency projection (multi-currency Phase 2) ────────────

/**
 * Projects every transaction in `txs` into `baseCurrency`, returning
 * a new array of `PerfTransaction` with `currencyCode` and `amount`
 * rewritten to the portfolio base currency where needed.
 *
 * Resolution priority per transaction:
 *   1. Same-currency (tx.currencyCode === baseCurrency) → pass through.
 *   2. GROSS_VALUE unit with fxCurrencyCode === baseCurrency and non-null
 *      fxAmount → use fxAmount (trade-date embedded rate; most accurate).
 *   3. Pre-built RateMap keyed by tx.currencyCode → multiply by trade-date
 *      rate (upstream-aligned trade-date FX, no period collapsing).
 *   4. Security tx with no rate → drop from projectedTxs + tag securityId
 *      in unresolvedSecurityIds (caller decides how to surface the gap).
 *   5. Cash-only tx (securityId === null) with no rate → keep unchanged
 *      (multi-currency deposit accounts; emit a warn, never drop).
 *
 * The caller is responsible for pre-building rateMaps via
 * `buildRateMap(db, fromCurrency, baseCurrency, start, end)` — this
 * helper performs no I/O.
 */
export function projectTransactionsToBaseCurrency(
  txs: PerfTransaction[],
  baseCurrency: string,
  rateMaps: Map<string, RateMap>,
): { projectedTxs: PerfTransaction[]; unresolvedSecurityIds: Set<string> } {
  const projectedTxs: PerfTransaction[] = [];
  const unresolvedSecurityIds = new Set<string>();
  const unresolvedCashCcys = new Set<string>();

  for (const tx of txs) {
    if (tx.currencyCode === baseCurrency || tx.currencyCode == null) {
      projectedTxs.push(tx);
      continue;
    }

    // Priority 2: GROSS_VALUE FOREX leg with fxCurrencyCode === baseCurrency
    const fxUnit = tx.units.find(
      (u) =>
        u.type === 'GROSS_VALUE' &&
        u.fxCurrencyCode === baseCurrency &&
        u.fxAmount != null,
    );
    if (fxUnit?.fxAmount != null) {
      projectedTxs.push({ ...tx, amount: fxUnit.fxAmount, currencyCode: baseCurrency });
      continue;
    }

    // Priority 3: vf_exchange_rate via pre-built RateMap
    const rateMap = rateMaps.get(tx.currencyCode);
    const rate = rateMap ? getRateFromMap(rateMap, tx.date) : null;
    if (rate) {
      const converted = new Decimal(tx.amount ?? 0).times(rate).toNumber(); // native-ok: Decimal → JS number for PerfTransaction.amount
      projectedTxs.push({ ...tx, amount: converted, currencyCode: baseCurrency });
      continue;
    }

    // Priority 4/5: no rate available
    if (tx.securityId) {
      // Security tx: drop and tag for caller
      unresolvedSecurityIds.add(tx.securityId);
    } else {
      // Cash-only tx: keep unchanged, emit a warning
      unresolvedCashCcys.add(tx.currencyCode);
      projectedTxs.push(tx);
    }
  }

  if (unresolvedCashCcys.size > 0) {
    console.warn(
      `[multi-currency] cash txs with unresolvable FX: currencies=${[...unresolvedCashCcys].join(',')}`,
    );
  }
  if (unresolvedSecurityIds.size > 0) {
    console.warn(
      `[multi-currency] dropping ${unresolvedSecurityIds.size} securities from rollup due to missing FX rates`,
    );
  }

  return { projectedTxs, unresolvedSecurityIds };
}

// ─── Batch DB fetches (anti-N+1) ─────────────────────────────────────────────

export function fetchAllTransactions(sqlite: BetterSqlite3.Database): PerfTransaction[] {
  // units_raw encoding (see parseRawRow): colon-separated 6 fields per unit:
  //   <type>:<amount>:<currency>:<forex_amount>:<forex_currency>:<exchangeRate>
  // NULLs become '' to preserve positional alignment. '|' separates units.
  const rows = sqlite
    .prepare(
      `SELECT x.*,
              GROUP_CONCAT(
                u.type
                || ':' || u.amount
                || ':' || COALESCE(u.currency, '')
                || ':' || COALESCE(u.forex_amount, '')
                || ':' || COALESCE(u.forex_currency, '')
                || ':' || COALESCE(u.exchangeRate, ''),
                '|'
              ) as units_raw,
              (SELECT ce.type FROM xact_cross_entry ce
               WHERE ce.from_xact = x.uuid OR ce.to_xact = x.uuid
               ORDER BY ce.type DESC NULLS LAST
               LIMIT 1) AS ceType
       FROM xact x
       LEFT JOIN xact_unit u ON u.xact = x.uuid
       GROUP BY x.uuid
       ORDER BY x.date ASC, x._order ASC, x._id ASC`,
    )
    .all() as RawXactRow[];
  return rows.map(parseRawRow);
}

export function fetchPricesForPeriod(
  sqlite: BetterSqlite3.Database,
  periodStart: string,
  periodEnd: string,
): Map<string, Map<string, Decimal>> {
  const rows = sqlite
    .prepare(
      `SELECT security, tstamp, value FROM price
       WHERE tstamp BETWEEN ? AND ?
       ORDER BY tstamp ASC`,
    )
    .all(periodStart, periodEnd) as { security: string; tstamp: string; value: number }[];

  const result = new Map<string, Map<string, Decimal>>();
  for (const row of rows) {
    if (!result.has(row.security)) result.set(row.security, new Map());
    result.get(row.security)!.set(row.tstamp, safeDecimal(row.value).div(1e8));
  }
  return result;
}

export function fetchPriceAtDate(
  sqlite: BetterSqlite3.Database,
  date: string,
): Map<string, Decimal> {
  const rows = sqlite
    .prepare(
      `SELECT p1.security, p1.value
       FROM price p1
       WHERE p1.tstamp = (
         SELECT MAX(p2.tstamp) FROM price p2
         WHERE p2.security = p1.security AND p2.tstamp <= ?
       )`,
    )
    .all(date) as { security: string; value: number }[];

  const result = new Map<string, Decimal>();
  for (const row of rows) {
    result.set(row.security, safeDecimal(row.value).div(1e8));
  }
  return result;
}

export function fetchLatestPrices(
  sqlite: BetterSqlite3.Database,
): Map<string, { price: Decimal; date: string | null }> {
  const rows = sqlite
    .prepare(`SELECT security, value, tstamp FROM latest_price`)
    .all() as { security: string; value: number; tstamp: string | null }[];

  const result = new Map<string, { price: Decimal; date: string | null }>();
  for (const row of rows) {
    result.set(row.security, {
      price: safeDecimal(row.value).div(1e8),
      date: row.tstamp ?? null,
    });
  }
  return result;
}

/**
 * Computes the total cash balance of a set of deposit accounts at a given date.
 * Uses raw ppxml2db type strings so TRANSFER_IN/OUT are handled correctly.
 */
function fetchDepositCashBalance(
  sqlite: BetterSqlite3.Database,
  accIds: Set<string>,
  upToDate: string,
): Decimal {
  if (accIds.size === 0) return new Decimal(0);
  const placeholders = [...accIds].map(() => '?').join(',');
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(
         CASE x.type
           WHEN 'DEPOSIT'          THEN  x.amount
           WHEN 'REMOVAL'          THEN -x.amount
           WHEN 'BUY'              THEN -x.amount
           WHEN 'SELL'             THEN  x.amount
           WHEN 'DIVIDENDS'        THEN  x.amount
           WHEN 'INTEREST'         THEN  x.amount
           WHEN 'FEES'             THEN -x.amount
           WHEN 'TAXES'            THEN -x.amount
           WHEN 'TAX_REFUND'       THEN  x.amount
           WHEN 'FEES_REFUND'      THEN  x.amount
           WHEN 'INTEREST_CHARGE'  THEN -x.amount
           WHEN 'TRANSFER_IN'      THEN  x.amount
           WHEN 'TRANSFER_OUT'     THEN -x.amount
           ELSE 0
         END
       ), 0) / 100.0 AS balance
       FROM xact x
       WHERE x.account IN (${placeholders}) AND SUBSTR(x.date, 1, 10) <= ?`,
    )
    .get([...accIds, upToDate]) as { balance: number };
  return new Decimal(row.balance ?? 0);
}

/**
 * Computes the cash balance for ALL deposit accounts at a given date in one query.
 * Returns a Map<accountUuid, Decimal>.
 */
function fetchAllDepositBalances(
  sqlite: BetterSqlite3.Database,
  upToDate: string,
): Map<string, Decimal> {
  const rows = sqlite
    .prepare(
      `SELECT x.account,
         COALESCE(SUM(
           CASE x.type
             WHEN 'DEPOSIT'          THEN  x.amount
             WHEN 'REMOVAL'          THEN -x.amount
             WHEN 'BUY'              THEN -x.amount
             WHEN 'SELL'             THEN  x.amount
             WHEN 'DIVIDENDS'        THEN  x.amount
             WHEN 'INTEREST'         THEN  x.amount
             WHEN 'FEES'             THEN -x.amount
             WHEN 'TAXES'            THEN -x.amount
             WHEN 'TAX_REFUND'       THEN  x.amount
             WHEN 'FEES_REFUND'      THEN  x.amount
             WHEN 'INTEREST_CHARGE'  THEN -x.amount
             WHEN 'TRANSFER_IN'      THEN  x.amount
             WHEN 'TRANSFER_OUT'     THEN -x.amount
             ELSE 0
           END
         ), 0) / 100.0 AS balance
       FROM xact x
       WHERE x.account IN (SELECT uuid FROM account WHERE type = 'account')
         AND SUBSTR(x.date, 1, 10) <= ?
       GROUP BY x.account`,
    )
    .all(upToDate) as { account: string; balance: number }[];
  const result = new Map<string, Decimal>();
  for (const r of rows) result.set(r.account, new Decimal(r.balance ?? 0));
  return result;
}

// ─── Computation helpers ──────────────────────────────────────────────────────

function computeDailyMarketValues(
  secTxs: TransactionWithUnits[],
  rawPriceMap: Map<string, Decimal>,
  period: { start: string; end: string },
): Map<string, Decimal> {
  let shares = new Decimal(0);

  // Accumulate pre-period shares
  for (const tx of secTxs) {
    if (tx.date >= period.start) break;
    if (tx.shares == null) continue;
    const txShares = safeDecimal(tx.shares).div(1e8);
    if (tx.type === TransactionType.BUY || tx.type === TransactionType.DELIVERY_INBOUND || tx.type === TransactionType.SECURITY_TRANSFER_INBOUND) {
      shares = shares.plus(txShares);
    } else if (tx.type === TransactionType.SELL || tx.type === TransactionType.DELIVERY_OUTBOUND || tx.type === TransactionType.SECURITY_TRANSFER_OUTBOUND) {
      shares = shares.minus(txShares);
    }
  }

  const inPeriodTxs = secTxs.filter(
    (tx) => tx.date >= period.start && tx.date <= period.end,
  );
  let txIndex = 0;
  const marketValues = new Map<string, Decimal>();
  const days = eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) });

  let lastKnownPrice: Decimal | undefined;

  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    while (txIndex < inPeriodTxs.length && inPeriodTxs[txIndex].date === dateStr) {
      const tx = inPeriodTxs[txIndex];
      if (tx.shares != null) {
        const txShares = safeDecimal(tx.shares).div(1e8);
        if (tx.type === TransactionType.BUY || tx.type === TransactionType.DELIVERY_INBOUND || tx.type === TransactionType.SECURITY_TRANSFER_INBOUND) {
          shares = shares.plus(txShares);
        } else if (
          tx.type === TransactionType.SELL ||
          tx.type === TransactionType.DELIVERY_OUTBOUND ||
          tx.type === TransactionType.SECURITY_TRANSFER_OUTBOUND
        ) {
          shares = shares.minus(txShares);
        }
      }
      txIndex++;
    }
    const price = rawPriceMap.get(dateStr);
    if (price !== undefined) {
      lastKnownPrice = price;
    }
    // Write MV every day once a price is known, using current shares × last known price
    if (lastKnownPrice !== undefined) {
      marketValues.set(dateStr, shares.times(lastKnownPrice));
    }
  }
  return marketValues;
}

function sharesAt(txs: TransactionWithUnits[], beforeDate: string, inclusive = false): Decimal {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  let shares = new Decimal(0);
  for (const tx of sorted) {
    if (inclusive ? tx.date > beforeDate : tx.date >= beforeDate) break;
    if (tx.shares == null) continue;
    const txShares = safeDecimal(tx.shares).div(1e8);
    if (tx.type === TransactionType.BUY || tx.type === TransactionType.DELIVERY_INBOUND || tx.type === TransactionType.SECURITY_TRANSFER_INBOUND) {
      shares = shares.plus(txShares);
    } else if (tx.type === TransactionType.SELL || tx.type === TransactionType.DELIVERY_OUTBOUND || tx.type === TransactionType.SECURITY_TRANSFER_OUTBOUND) {
      shares = shares.minus(txShares);
    }
  }
  return shares;
}

/**
 * Aggregate net shares per security from the xact table via SQL.
 * BUY/DELIVERY_INBOUND add shares; SELL/DELIVERY_OUTBOUND subtract.
 * Returns all securities (including zero-share) — caller decides filtering.
 */
export function fetchNetSharesPerSecurity(
  sqlite: BetterSqlite3.Database,
  endDate: string | null,
  securityId?: string,
): Map<string, Decimal> {
  const conditions: string[] = ['security IS NOT NULL'];
  const params: string[] = [];
  // SUBSTR(date, 1, 10) is load-bearing: xact.date is stored as ppxml2db's
  // ISO timestamp ('YYYY-MM-DDTHH:MM') while period boundaries arrive as
  // 'YYYY-MM-DD'. SQLite lex compare → 'YYYY-MM-DDT07:02' > 'YYYY-MM-DD',
  // so a bare `date <= ?` silently drops every transaction stamped on the
  // boundary date. fetchDepositCashBalance / fetchAllDepositBalances apply
  // the same normalization for the same reason; keep the three siblings in
  // sync. Symmetric `>= ?` filters are SAFE without SUBSTR (a timestamp
  // sorts AFTER its bare-date prefix), so this normalization is only needed
  // on `<= ?` / `BETWEEN ? AND ?` filters.
  if (endDate) { conditions.push('SUBSTR(date, 1, 10) <= ?'); params.push(endDate); }
  if (securityId) { conditions.push('security = ?'); params.push(securityId); }
  const sql = `SELECT security,
    SUM(CASE
      WHEN type IN ('BUY', 'DELIVERY_INBOUND') THEN shares
      WHEN type IN ('SELL', 'DELIVERY_OUTBOUND') THEN -shares
      ELSE 0
    END) AS net_shares_raw
   FROM xact
   WHERE ${conditions.join(' AND ')}
   GROUP BY security`;
  const rows = sqlite.prepare(sql).all(...params) as { security: string; net_shares_raw: number }[];
  return new Map(rows.map((r) => [r.security, new Decimal(r.net_shares_raw).div(1e8)]));
}

function sumUnitTypeInPeriod(
  txs: TransactionWithUnits[],
  unitType: 'FEE' | 'TAX',
  period: { start: string; end: string },
): Decimal {
  let total = new Decimal(0);
  for (const tx of txs) {
    if (tx.date < period.start || tx.date > period.end) continue;
    const matchingUnits = tx.units.filter((u) => u.type === unitType);
    if (matchingUnits.length > 0) {
      for (const u of matchingUnits) total = total.plus(safeDecimal(u.amount));
    } else if (unitType === 'FEE' && tx.type === TransactionType.FEES) {
      // Standalone FEES have no xact_unit rows; amount is in xact.amount
      total = total.plus(safeDecimal(tx.amount ?? 0));
    } else if (unitType === 'FEE' && tx.type === TransactionType.FEES_REFUND) {
      // FEES_REFUND reduces the fee total (subtract, not add)
      total = total.minus(safeDecimal(tx.amount ?? 0));
    } else if (unitType === 'TAX' && tx.type === TransactionType.TAXES) {
      // Standalone TAXES have no xact_unit rows; amount is in xact.amount
      total = total.plus(safeDecimal(tx.amount ?? 0));
    } else if (unitType === 'TAX' && tx.type === TransactionType.TAX_REFUND) {
      // TAX_REFUND reduces the tax total (subtract, not add)
      total = total.minus(safeDecimal(tx.amount ?? 0));
    }
  }
  return total;
}

function sumByTypeInPeriod(
  txs: TransactionWithUnits[],
  type: TransactionType,
  period: { start: string; end: string },
): Decimal {
  return txs
    .filter((tx) => tx.date >= period.start && tx.date <= period.end && tx.type === type)
    .reduce((sum, tx) => sum.plus(getGrossAmount(tx)), new Decimal(0));
}

/**
 * Sum gross amounts for earnings-type transactions (DIVIDEND, INTEREST).
 * Earnings are shown at gross (including fees and taxes) in the Calculation panel.
 *
 * When GROSS_VALUE unit exists (QV-created data): uses it directly.
 * When GROSS_VALUE is missing (ppxml2db data): xact.amount = net (after taxes/fees),
 * so we reconstruct gross = net + TAX units + FEE units.
 */
function sumGrossEarningsByType(
  txs: TransactionWithUnits[],
  type: TransactionType,
  period: { start: string; end: string },
): Decimal {
  return txs
    .filter((tx) => tx.date >= period.start && tx.date <= period.end && tx.type === type)
    .reduce((sum, tx) => {
      // getGrossAmount already handles ppxml2db reconstruction (amount ± fees ± taxes)
      return sum.plus(getGrossAmount(tx));
    }, new Decimal(0));
}

// Converts a deposit-currency amount to base at the given trade date.
// Returns null when the rate is unavailable (caller skips the tx).
function txAmountToBase(
  amount: Decimal,
  ccy: string,
  baseCurrency: string,
  rateMaps: Map<string, RateMap>,
  date: string,
): Decimal | null {
  if (ccy === baseCurrency) return amount;
  const rateMap = rateMaps.get(ccy);
  const rate = rateMap ? getRateFromMap(rateMap, date) : null;
  return rate ? convertToBase(amount, rate) : null;
}

// Sums deposit-ccy tx.amount → base using per-transaction frozen FX rates.
function sumAmountInBaseByType(
  txs: TransactionWithUnits[],
  type: TransactionType,
  period: { start: string; end: string },
  rateMaps: Map<string, RateMap>,
  baseCurrency: string,
): Decimal {
  return txs
    .filter((tx) => tx.date >= period.start && tx.date <= period.end && tx.type === type)
    .reduce((sum, tx) => {
      if (tx.amount == null) return sum;
      const converted = txAmountToBase(new Decimal(tx.amount), tx.currencyCode ?? baseCurrency, baseCurrency, rateMaps, tx.date);
      return converted != null ? sum.plus(converted) : sum;
    }, new Decimal(0));
}

// Sums deposit-ccy FEE or TAX xact_unit amounts → base using per-transaction frozen FX rates.
function sumUnitAmountInBase(
  txs: TransactionWithUnits[],
  unitType: 'FEE' | 'TAX',
  period: { start: string; end: string },
  rateMaps: Map<string, RateMap>,
  baseCurrency: string,
): Decimal {
  return txs
    .filter((tx) => tx.date >= period.start && tx.date <= period.end)
    .reduce((sum, tx) => {
      const matched = tx.units.filter((u) => u.type === unitType);
      if (matched.length === 0) return sum;
      const unitTotal = matched.reduce((s, u) => s.plus(new Decimal(u.amount)), new Decimal(0));
      const converted = txAmountToBase(unitTotal, tx.currencyCode ?? baseCurrency, baseCurrency, rateMaps, tx.date);
      return converted != null ? sum.plus(converted) : sum;
    }, new Decimal(0));
}

function toCostTransactions(txs: TransactionWithUnits[]): CostTransaction[] {
  const validTypes = new Set<string>([
    TransactionType.BUY,
    TransactionType.SELL,
    TransactionType.DELIVERY_INBOUND,
    TransactionType.DELIVERY_OUTBOUND,
    TransactionType.SECURITY_TRANSFER_INBOUND,
    TransactionType.SECURITY_TRANSFER_OUTBOUND,
  ]);
  return txs
    .filter((tx) =>
      validTypes.has(tx.type) &&
      // Exclude cash-account counter-entries (shares=0): double-entry artifact
      !((tx.type === TransactionType.BUY || tx.type === TransactionType.SELL) &&
        tx.shares === 0),
    )
    .map((tx) => ({
      type: tx.type as CostTransaction['type'],
      date: tx.date,
      shares: tx.shares != null ? safeDecimal(tx.shares).div(1e8) : new Decimal(0),
      grossAmount: getGrossAmount(tx),
      fees: getFees(tx),
    }));
}

/**
 * Computes the running cash balance for each day in the period.
 * Includes all cash-affecting transactions:
 *   - DEPOSIT/REMOVAL (external flows)
 *   - BUY/SELL with shares=0 (cash-account side of securities trades)
 *   - DIVIDEND, INTEREST, TAX_REFUND (cash inflows)
 *   - FEES, TAXES, INTEREST_CHARGE (cash outflows)
 * Note: BUY/SELL with shares>0 are the securities-side records — excluded to avoid double-counting.
 */
export function buildDailyCashMap(
  allTxs: TransactionWithUnits[],
  period: { start: string; end: string },
  depositAccIds?: Set<string>,
): Map<string, Decimal> {
  // No deposit accounts in scope → no cash component.
  // Without this guard, DIVIDEND/TAX_REFUND/INTEREST transactions that pass the
  // security-based txFilter would accumulate a phantom cash balance, inflating
  // the total daily MV for security-only scopes (taxonomy, individual security).
  if (depositAccIds && depositAccIds.size === 0) return new Map();

  const cashImpact = (tx: TransactionWithUnits): Decimal => {
    const gross = tx.amount != null ? new Decimal(tx.amount) : new Decimal(0);
    // For BUY/SELL, use account-type check when available: cash impact only applies on deposit accounts.
    // Falling back to shares===0 for backwards compat when depositAccIds is not provided.
    const isDepositAccount = depositAccIds
      ? depositAccIds.has((tx as PerfTransaction).accountId)
      : (tx.shares === 0 || tx.shares == null);
    switch (tx.type) {
      case TransactionType.DEPOSIT:
        return gross;
      case TransactionType.REMOVAL:
        return gross.negated();
      case TransactionType.BUY:
        return isDepositAccount ? gross.negated() : new Decimal(0);
      case TransactionType.SELL:
        return isDepositAccount ? gross : new Decimal(0);
      case TransactionType.DIVIDEND:
        // Dividend: xact.amount is already NET in ppxml2db — never subtract fees/taxes again
        return tx.shares != null && tx.shares > 0 ? gross : new Decimal(0);
      case TransactionType.INTEREST:
        return gross;
      case TransactionType.FEES:
        return gross.negated();
      case TransactionType.TAXES:
        return gross.negated();
      case TransactionType.TAX_REFUND:
        return gross;
      case TransactionType.INTEREST_CHARGE:
        return gross.negated();
      case TransactionType.FEES_REFUND:
        return gross;
      case TransactionType.DELIVERY_INBOUND:
        // Cash transfers (TRANSFER_IN in ppxml2db) have shares=0, security=null
        return tx.shares === 0 || tx.shares == null ? gross : new Decimal(0);
      case TransactionType.DELIVERY_OUTBOUND:
        // Cash transfers (TRANSFER_OUT in ppxml2db) have shares=0, security=null
        return tx.shares === 0 || tx.shares == null ? gross.negated() : new Decimal(0);
      case TransactionType.TRANSFER_BETWEEN_ACCOUNTS:
        // Cash transfers normalised from TRANSFER_IN/OUT: use isTransferOut to determine direction.
        // Amount is always positive in ppxml2db; outbound = cash leaves, inbound = cash enters.
        return (tx as PerfTransaction).isTransferOut ? gross.negated() : gross;
      case TransactionType.SECURITY_TRANSFER:
        // Security transfers move shares between security accounts — no cash impact.
        return new Decimal(0);
      default:
        return new Decimal(0);
    }
  };

  // Compute cash at period.start from all pre-period transactions (O(n) scan)
  let runningCash = new Decimal(0);
  for (const tx of allTxs) {
    if (tx.date >= period.start) break;
    runningCash = runningCash.plus(cashImpact(tx));
  }

  const result = new Map<string, Decimal>();
  const days = eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) });
  const inPeriodTxs = allTxs.filter((tx) => tx.date >= period.start && tx.date <= period.end);
  let txIndex = 0;

  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    while (txIndex < inPeriodTxs.length && inPeriodTxs[txIndex].date === dateStr) {
      runningCash = runningCash.plus(cashImpact(inPeriodTxs[txIndex]));
      txIndex++;
    }
    result.set(dateStr, runningCash);
  }
  return result;
}

// ─── Internal security-level result (Decimal, for aggregation) ───────────────

export interface SecurityPerfInternal {
  securityId: string;
  ttwror: Decimal;
  ttwrorPa: Decimal;
  irr: Decimal | null;
  mvb: Decimal;
  mve: Decimal;
  purchaseValue: Decimal;
  realizedGain: Decimal;
  unrealizedGain: Decimal;
  foreignCurrencyGains: Decimal;
  fees: Decimal;
  taxes: Decimal;
  dividends: Decimal;
  interest: Decimal;
  sharesEnd: Decimal;
  dailyMV: Map<string, Decimal>;
  dailyReturns: Array<{ date: string; r: Decimal; cumR: Decimal }>;
  // Broker-style open-position PnL (since-inception, unrealized on currently-held shares only).
  // MA = moving-average / PMC convention (matches Directa, Fineco, etc.)
  // FIFO = first-in-first-out alternative
  openPositionCost: Decimal;      // MA: PMC × heldShares (cost basis of what's still held)
  openPositionValue: Decimal;     // currentPrice × heldShares
  openPositionPnL: Decimal;       // openPositionValue − openPositionCost
  openPositionCostFifo: Decimal;  // FIFO cost of remaining lots
  openPositionPnLFifo: Decimal;   // openPositionValue − openPositionCostFifo
}

function computeSecurityPerfInternal(
  secTxs: TransactionWithUnits[],
  securityId: string,
  priceMap: Map<string, Decimal>,
  priceAtStart: Decimal,
  latestPrice: Decimal,
  latestPriceDate: string | null,
  period: { start: string; end: string },
  costMethod: CostMethod,
  preTax: boolean,
): SecurityPerfInternal {
  const periodDays = differenceInCalendarDays(parseISO(period.end), parseISO(period.start));

  // Inject priceAtStart so carryForwardPrices can fill gaps from day 0.
  // Fall back to latestPrice when no historical price is available (e.g. only recent prices in DB).
  const mergedPriceMap = new Map(priceMap);
  const effectivePriceAtStart = priceAtStart.gt(0) ? priceAtStart : latestPrice;
  if (effectivePriceAtStart.gt(0) && !mergedPriceMap.has(period.start)) {
    mergedPriceMap.set(period.start, effectivePriceAtStart);
  }

  // Inject latest_price when: (a) no historical close exists for that date, OR
  // (b) it IS the period-end date — latest_price is the most current available
  // price and must be used for MVE even when a same-day historical snapshot exists.
  // For intermediate days within the period, historical close always wins.
  if (
    latestPrice.gt(0) &&
    latestPriceDate !== null &&
    latestPriceDate <= period.end &&
    latestPriceDate >= period.start &&
    (!mergedPriceMap.has(latestPriceDate) || latestPriceDate === period.end)
  ) {
    mergedPriceMap.set(latestPriceDate, latestPrice);
  }
  secTxs = inheritTransferCostBasis(secTxs);
  const dailyMV = computeDailyMarketValues(secTxs, mergedPriceMap, period);

  // Security-level TTWROR/IRR never include taxes (fees are intrinsic,
  // taxes are extrinsic). Use separate cashflows for perf vs display.
  const perfCashflows = resolveSecurityCashflows(secTxs, securityId, false);
  const snapshots = buildDailySnapshotsWithCarry(perfCashflows, dailyMV, period);
  const ttwrorResult = computeTTWROR(snapshots, periodDays);

  const filledMV = carryForwardPrices(dailyMV, period.start, period.end);
  const mvb = filledMV.get(period.start) ?? new Decimal(0);
  const mve = filledMV.get(period.end) ?? new Decimal(0);

  // Exclude start-day cashflows: MVB is end-of-day and already reflects them.
  const inPeriodCFs = perfCashflows.filter(
    (cf) => cf.date > period.start && cf.date <= period.end,
  );
  const irrResult = computeIRR({
    mvb,
    mve,
    cashflows: inPeriodCFs,
    periodStart: period.start,
    periodEnd: period.end,
  });

  const allCostTxs = toCostTransactions(secTxs);
  const pvResult = computePurchaseValue({
    transactions: allCostTxs,
    costMethod,
    reportingPeriod: period,
    priceAtPeriodStart: effectivePriceAtStart,
    currentPrice: latestPrice,
  });

  const sharesStart = sharesAt(secTxs, period.start);
  const sharesEnd = sharesAt(secTxs, period.end, true);
  const valueAtStart = sharesStart.times(effectivePriceAtStart);

  // Broker-style open-position PnL — full history (no period rebasing), unrealized only.
  // MA gives the PMC convention used by Italian retail brokers (Directa, Fineco, …).
  const maAll   = computeMovingAverage(allCostTxs, latestPrice);
  const fifoAll = computeFIFO(allCostTxs, latestPrice);
  const openPositionValue    = sharesEnd.times(latestPrice);
  const openPositionCost     = maAll.purchaseValue;
  const openPositionPnL      = maAll.unrealizedGain;
  const openPositionCostFifo = fifoAll.purchaseValue;
  const openPositionPnLFifo  = fifoAll.unrealizedGain;

  // Price at period end: last known from price map, fall back to latest
  const filledPrices = carryForwardPrices(mergedPriceMap, period.start, period.end);
  const priceAtEnd = filledPrices.get(period.end) ?? latestPrice;

  const inPeriodCostTxs = allCostTxs.filter(
    (tx) => tx.date >= period.start && tx.date <= period.end,
  );
  // Capital gains use cost without fees and taxes.
  // Fees are accounted separately on the Fees line of the Calculation panel.
  const inPeriodCostTxsForGains = inPeriodCostTxs.map((tx) => ({
    ...tx,
    fees: new Decimal(0),
  }));
  const gainsResult = computePeriodRelativeGains({
    valueAtPeriodStart: valueAtStart,
    sharesAtPeriodStart: sharesStart,
    inPeriodTransactions: inPeriodCostTxsForGains,
    priceAtPeriodEnd: priceAtEnd,
    sharesAtPeriodEnd: sharesEnd,
    costMethod,
  });

  const fees = sumUnitTypeInPeriod(secTxs, 'FEE', period);
  const taxes = preTax ? new Decimal(0) : sumUnitTypeInPeriod(secTxs, 'TAX', period);
  const dividends = sumGrossEarningsByType(secTxs, TransactionType.DIVIDEND, period);
  const interest = sumGrossEarningsByType(secTxs, TransactionType.INTEREST, period);

  return {
    securityId,
    ttwror: ttwrorResult.cumulative,
    ttwrorPa: ttwrorResult.annualized,
    irr: irrResult,
    mvb,
    mve,
    purchaseValue: pvResult.purchaseValue,
    realizedGain: gainsResult.realizedGain,
    unrealizedGain: gainsResult.unrealizedGain,
    foreignCurrencyGains: gainsResult.foreignCurrencyGains,
    fees,
    taxes,
    dividends,
    interest,
    sharesEnd,
    dailyMV,
    dailyReturns: ttwrorResult.dailyReturns,
    openPositionCost,
    openPositionValue,
    openPositionPnL,
    openPositionCostFifo,
    openPositionPnLFifo,
  };
}

// ─── Public result types ──────────────────────────────────────────────────────

export interface SecurityPerfResult {
  securityId: string;
  currency: string;
  ttwror: string;
  ttwrorPa: string;
  irr: string | null;
  irrConverged: boolean;
  mvb: string;
  mve: string;
  purchaseValue: string;
  realizedGain: string;
  unrealizedGain: string;
  foreignCurrencyGains: string;
  fees: string;
  taxes: string;
  dividends: string;
  interest: string;
  shares: string;
  baseCurrency: string;
  marketValueBase: string;
  /** Surviving-lot cost basis in base ccy via per-lot FIFO + trade-date FX. */
  costBase: string;
  /**
   * `sr.unrealizedGain` × period-end FX rate. **Period-end-uniform projection** —
   * NOT the same number as `unrealizedCapitalBase + unrealizedFxBase`, which
   * uses per-lot acquisition rates. Kept for backward compatibility with the
   * Investments table and SecurityDrawer (`packages/web/src/...`). Future
   * contributors: do not attempt to "fix" the identity by replacing this with
   * the decomposition sum — that would silently change UI numbers users
   * already see.
   */
  unrealizedBase: string;
  /**
   * `sr.realizedGain` × period-end FX rate. Same period-end-uniform caveat as
   * `unrealizedBase`. Does NOT equal `realizedCapitalBase + realizedFxBase`.
   */
  realizedBase: string;
  /** `sr.dividends` × period-end FX rate. Does NOT include `dividendFxBase`. */
  dividendsBase: string;

  // ─── Phase 3 — capital / FX decomposition (all in base ccy) ────────────────
  /**
   * Realized capital component (base ccy) on consumed SELL slices:
   *   sum(shares × (sellPrice − lotPrice) × sellRate)
   * Pure market move at the SELL date's FX rate. '0' on coverage gap or same-ccy.
   */
  realizedCapitalBase: string;
  /**
   * Realized FX component (base ccy) on consumed SELL slices:
   *   sum(shares × lotPrice × (sellRate − lotRate))
   * FX move on cost basis between the BUY's acquisition rate and the SELL rate.
   * Together with `realizedCapitalBase`: sum = sellValueInBase − costInBase
   * (algebraic identity). '0' on coverage gap or same-ccy.
   */
  realizedFxBase: string;

  /**
   * Unrealized capital component (base ccy) on surviving lots:
   *   sum(shares × (currentPrice − lotPrice) × currentRate)
   */
  unrealizedCapitalBase: string;
  /**
   * Unrealized FX component (base ccy) on surviving lots:
   *   sum(shares × lotPrice × (currentRate − lotRate))
   * Together with `unrealizedCapitalBase`: sum = mvBase − costBase
   * (algebraic identity). '0' on coverage gap or same-ccy.
   */
  unrealizedFxBase: string;

  // Cumulative FX gain/loss on received dividends between receipt date and
  // period.end, in base ccy:
  //   sum over DIVIDEND txs: tx.amount × (endRate − receiptRate)
  // where the rate is for the dividend's own deposit currency. Zero when the
  // dividend lands in base ccy. Defaults to '0' on coverage gap.
  dividendFxBase: string;

  // ─── Phase 3 — dual TTWROR / IRR pass in base ccy ──────────────────────────
  // Same TTWROR/IRR shape as `ttwror`/`ttwrorPa`/`irr`, but computed from a
  // second pass where every cashflow + daily MV is projected to base ccy.
  // For a USD security in a EUR-base portfolio, `ttwror` is the USD-native
  // return; `ttwrorBase` is the return as a EUR investor experiences it
  // (capital + FX combined). Short-circuits to the native fields when
  // secCcy === baseCcy. Defaults to the native value on coverage gap.
  ttwrorBase: string;
  ttwrorPaBase: string;
  irrBase: string | null;
  irrBaseConverged: boolean;
}

export interface PortfolioCalcResult {
  baseCurrency: string;
  unresolvedCount: number;
  unresolvedSecurityIds: string[];
  initialValue: string;
  capitalGains: CapitalGainsBreakdown;
  realizedGains: RealizedGainsBreakdown;
  earnings: EarningsBreakdown;
  fees: FeesBreakdown;
  taxes: TaxesBreakdown;
  cashCurrencyGains: CashCurrencyGainsBreakdown;
  performanceNeutralTransfers: PntBreakdown;
  finalValue: string;
  irr: string | null;
  irrConverged: boolean;
  irrError: string | null;
  ttwror: string;
  ttwrorPa: string;
  absoluteChange: string;
  deltaValue: string;
  delta: string;
  absolutePerformance: string;
  absolutePerformancePct: string;
  maxDrawdown: string;
  currentDrawdown: string;
  maxDrawdownPeakDate: string | null;
  maxDrawdownTroughDate: string | null;
  maxDrawdownDuration: number;
  volatility: string | null;
  semivariance: string | null;
  sharpeRatio: string | null;
  openPositionPnL: OpenPositionPnLBreakdown;

  // ─── Phase 3 — capital / FX decomposition rollups (all in base ccy) ────────
  // Portfolio-level sums of the per-security decomposition fields emitted on
  // SecurityPerfResult (Task 7). These use per-tx trade-date FX (strict PP
  // convention via per-lot acquisition rates), NOT the period-end-uniform
  // rate the legacy `capitalGains.realized` / `capitalGains.unrealized`
  // aggregates use. The two intentionally do NOT sum to the same number —
  // see the SecurityPerfResult.unrealizedBase / realizedBase comments for
  // the rationale (preserves visible UI numbers).
  //
  // Defaults to '0' when no per-security decomposition is computable (every
  // security same-ccy as base, or coverage gap on every FX rate).
  // Unresolved-FX securities are skipped via the same `continue` that
  // excludes them from totalMVB/totalMVE.
  realizedCapitalBase: string;
  realizedFxBase: string;
  unrealizedCapitalBase: string;
  unrealizedFxBase: string;
  dividendFxBase: string;
}

export interface ChartPoint {
  date: string;
  marketValue: string;
  transfersAccumulated: string;
  ttwrorCumulative: string;
  delta: string;
  drawdown: string;
}

// ─── Shared batch fetch + grouping ───────────────────────────────────────────

export interface BatchData {
  allTxs: PerfTransaction[];
  txsBySecurity: Map<string, TransactionWithUnits[]>;
  allPrices: Map<string, Map<string, Decimal>>;
  pricesAtStart: Map<string, Decimal>;
  latestPrices: Map<string, { price: Decimal; date: string | null }>;
  retiredSecIds: Set<string>;
  retiredAccIds: Set<string>;
  depositAccIds: Set<string>;
  secCurrencyMap: Map<string, string>;
  depositAccCurrencyMap: Map<string, string>;
  securityInfoMap: Map<string, { name: string; isin?: string }>;
  accountNameMap: Map<string, string>;
}

export function fetchBatchData(
  sqlite: BetterSqlite3.Database,
  period: { start: string; end: string },
): BatchData {
  const allTxs = fetchAllTransactions(sqlite);
  const allPrices = fetchPricesForPeriod(sqlite, period.start, period.end);
  const pricesAtStart = fetchPriceAtDate(sqlite, period.start);
  const latestPrices = fetchLatestPrices(sqlite);

  const txsBySecurity = new Map<string, TransactionWithUnits[]>();
  for (const tx of allTxs) {
    if (!tx.securityId) continue;
    if (!txsBySecurity.has(tx.securityId)) txsBySecurity.set(tx.securityId, []);
    txsBySecurity.get(tx.securityId)!.push(tx);
  }

  const retiredSecIds = new Set<string>(
    (sqlite.prepare(`SELECT uuid FROM security WHERE isRetired = 1`).all() as { uuid: string }[])
      .map((r) => r.uuid),
  );
  const retiredAccIds = new Set<string>(
    (sqlite.prepare(`SELECT uuid FROM account WHERE isRetired = 1`).all() as { uuid: string }[])
      .map((r) => r.uuid),
  );
  const depositAccIds = new Set<string>(
    (sqlite.prepare(`SELECT uuid FROM account WHERE type = 'account'`).all() as { uuid: string }[])
      .map((r) => r.uuid),
  );

  const secCurrencyMap = new Map<string, string>();
  const securityInfoMap = new Map<string, { name: string; isin?: string }>();
  const secRows = sqlite.prepare(
    `SELECT uuid, currency, name, isin FROM security`
  ).all() as { uuid: string; currency: string | null; name: string; isin: string | null }[];
  for (const row of secRows) {
    secCurrencyMap.set(row.uuid, row.currency ?? 'EUR');
    securityInfoMap.set(row.uuid, { name: row.name, isin: row.isin || undefined });
  }

  const depositAccCurrencyMap = new Map<string, string>();
  const accountNameMap = new Map<string, string>();
  // Deposit accounts (for currency map)
  const accRows = sqlite.prepare(
    `SELECT uuid, currency, name FROM account WHERE type = 'account'`
  ).all() as { uuid: string; currency: string | null; name: string }[];
  for (const row of accRows) {
    depositAccCurrencyMap.set(row.uuid, row.currency ?? 'EUR');
    accountNameMap.set(row.uuid, row.name);
  }
  // All other accounts (portfolio etc.) — for accountNameMap only
  const allAccRows = sqlite.prepare(
    `SELECT uuid, name FROM account WHERE type != 'account'`
  ).all() as { uuid: string; name: string }[];
  for (const row of allAccRows) {
    accountNameMap.set(row.uuid, row.name);
  }

  return { allTxs, txsBySecurity, allPrices, pricesAtStart, latestPrices, retiredSecIds, retiredAccIds, depositAccIds, secCurrencyMap, depositAccCurrencyMap, securityInfoMap, accountNameMap };
}

/**
 * Build a per-call FX context: portfolio base currency + a RateMap for every
 * foreign currency referenced by securities or deposit accounts. Pre-building
 * the maps once amortises the cost across all per-day FX lookups inside the
 * aggregation loop and the cashflow projection pass.
 *
 * Consolidates three previously-duplicated blocks in getPortfolioCalc,
 * getChartData, and getReturnsHeatmap. Wire-emission paths (Task 9) reuse
 * the same helper.
 */
function buildFxContext(
  sqlite: BetterSqlite3.Database,
  data: BatchData,
  period: { start: string; end: string },
): { baseCurrency: string; rateMaps: Map<string, RateMap> } {
  const baseCurrency = getPortfolioBaseCurrency(sqlite);
  const foreignCurrencies = new Set<string>();
  for (const [, cur] of data.secCurrencyMap) {
    if (cur !== baseCurrency) foreignCurrencies.add(cur);
  }
  for (const [, cur] of data.depositAccCurrencyMap) {
    if (cur !== baseCurrency) foreignCurrencies.add(cur);
  }
  const rateMaps = new Map<string, RateMap>();
  for (const cur of foreignCurrencies) {
    rateMaps.set(cur, buildRateMap(sqlite, cur, baseCurrency, period.start, period.end));
  }
  return { baseCurrency, rateMaps };
}

/**
 * When an account scope is active, TRANSFER_BETWEEN_ACCOUNTS entries must be
 * appended to the cashflow list so that TTWROR neutralises them.
 * At full-portfolio level these transfers are internal (cancel out between accounts),
 * but at single-account level they are external money flows.
 */
function appendTransferCashflows(
  cashflows: Cashflow[],
  scopedTxs: PerfTransaction[],
  period: { start: string; end: string },
): void {
  for (const tx of scopedTxs) {
    if (tx.type !== TransactionType.TRANSFER_BETWEEN_ACCOUNTS) continue;
    if (tx.date < period.start || tx.date > period.end) continue;
    const gross = new Decimal(tx.amount ?? 0);
    const transferAmount = tx.isTransferOut ? gross.negated() : gross;
    cashflows.push({ date: tx.date, amount: transferAmount, type: tx.type });
  }
}

/**
 * Build cashflows for the securities-only scope (no deposit account).
 * PP §3.3: BUY/SELL → DELIVERY_INBOUND/OUTBOUND using full settlement amount.
 * PP §3.5: dividends/fees from non-scoped accounts → offsetting REMOVAL/DEPOSIT.
 */
function buildSecurityOnlyCashflows(
  scopedTxs: PerfTransaction[],
  allTxs: PerfTransaction[],
  scope: CalcScope,
  period: { start: string; end: string },
): Cashflow[] {
  const cashflows: Cashflow[] = [];

  // §3.3: BUY/SELL from scoped portfolio account → DELIVERY_INBOUND/OUTBOUND
  for (const tx of scopedTxs) {
    if (tx.date < period.start || tx.date > period.end) continue;
    if (!tx.securityId || !scope.securityIds.has(tx.securityId)) continue;
    const sw = scope.securityWeights?.get(tx.securityId) ?? new Decimal(1);
    const amount = new Decimal(tx.amount ?? 0).times(sw);
    if (amount.isZero()) continue;
    switch (tx.type) {
      case TransactionType.BUY:
      case TransactionType.DELIVERY_INBOUND:
        if (tx.shares != null && tx.shares > 0) {
          cashflows.push({ date: tx.date, amount, type: TransactionType.DELIVERY_INBOUND });
        }
        break;
      case TransactionType.SELL:
      case TransactionType.DELIVERY_OUTBOUND:
        if (tx.shares != null && tx.shares > 0) {
          cashflows.push({ date: tx.date, amount: amount.negated(), type: TransactionType.DELIVERY_OUTBOUND });
        }
        break;
    }
  }

  // §3.5: transactions on NON-scoped accounts for scoped securities
  for (const tx of allTxs) {
    if (tx.date < period.start || tx.date > period.end) continue;
    if (!tx.securityId || !scope.securityIds.has(tx.securityId)) continue;
    if (scope.txFilter && scope.txFilter(tx)) continue;
    const sw = scope.securityWeights?.get(tx.securityId) ?? new Decimal(1);
    const amount = new Decimal(tx.amount ?? 0).times(sw);
    if (amount.isZero()) continue;
    switch (tx.type) {
      case TransactionType.DIVIDEND:
        if (tx.shares != null && tx.shares > 0) {
          cashflows.push({ date: tx.date, amount: amount.negated(), type: TransactionType.REMOVAL });
        }
        break;
      case TransactionType.FEES:
        cashflows.push({ date: tx.date, amount, type: TransactionType.DEPOSIT });
        break;
      case TransactionType.FEES_REFUND:
        cashflows.push({ date: tx.date, amount: amount.negated(), type: TransactionType.REMOVAL });
        break;
    }
  }

  return cashflows;
}

/**
 * Zero-shaped `SecurityPerfInternal` used as the fallback when
 * `computeSecurityPerfInternal` throws. Keeps the security row visible
 * in the response so the frontend renders `—` for the failing metrics
 * instead of dropping the entire portfolio table on the first
 * per-security exception.
 */
function emptySecurityPerf(securityId: string): SecurityPerfInternal {
  const zero = new Decimal(0);
  return {
    securityId,
    ttwror: zero,
    ttwrorPa: zero,
    irr: null,
    mvb: zero,
    mve: zero,
    purchaseValue: zero,
    realizedGain: zero,
    unrealizedGain: zero,
    foreignCurrencyGains: zero,
    fees: zero,
    taxes: zero,
    dividends: zero,
    interest: zero,
    sharesEnd: zero,
    dailyMV: new Map(),
    dailyReturns: [],
    openPositionCost: zero,
    openPositionValue: zero,
    openPositionPnL: zero,
    openPositionCostFifo: zero,
    openPositionPnLFifo: zero,
  };
}

export function computeAllSecurities(
  sqlite: BetterSqlite3.Database,
  data: BatchData,
  period: { start: string; end: string },
  costMethod: CostMethod,
  preTax: boolean,
  securityFilter?: Set<string>,
  txFilter?: (tx: PerfTransaction) => boolean,
): SecurityPerfInternal[] {
  const results: SecurityPerfInternal[] = [];
  for (const [securityId, secTxs] of data.txsBySecurity) {
    if (securityFilter && !securityFilter.has(securityId)) continue;
    const filteredTxs = txFilter ? (secTxs as PerfTransaction[]).filter(txFilter) : secTxs;
    if (filteredTxs.length === 0) continue;
    const priceMap = data.allPrices.get(securityId) ?? new Map();
    const priceAtStart = data.pricesAtStart.get(securityId) ?? new Decimal(0);
    const latestPriceEntry = data.latestPrices.get(securityId);
    const latestPrice = latestPriceEntry?.price ?? new Decimal(0);
    const latestPriceDate = latestPriceEntry?.date ?? null;
    // Project to security currency BEFORE per-security math (see
    // docs/architecture/multi-currency.md). priceMap, priceAtStart, and
    // latestPrice are already in security currency (price.value is stored
    // in security.currency); projecting the transactions makes the cost
    // basis, cashflows, fees, and earnings unit-consistent with the MV.
    const securityCurrency = data.secCurrencyMap.get(securityId) ?? 'EUR';
    const projectedTxs = projectTransactionsToSecurityCurrency(
      sqlite,
      filteredTxs as PerfTransaction[],
      securityCurrency,
    );
    try {
      results.push(
        computeSecurityPerfInternal(
          projectedTxs,
          securityId,
          priceMap,
          priceAtStart,
          latestPrice,
          latestPriceDate,
          period,
          costMethod,
          preTax,
        ),
      );
    } catch (err) {
      // One bad security must not blank the entire portfolio table.
      // Log server-side, emit a zero-shaped row so the frontend still
      // renders the security with `—` metrics.
      // eslint-disable-next-line no-console
      console.error(
        `[performance] computeSecurityPerfInternal failed for ${securityId}: ${(err as Error).message}`,
      );
      results.push(emptySecurityPerf(securityId));
    }
  }
  return results;
}

// ─── Portfolio total daily MV helper ─────────────────────────────────────────

/**
 * Aggregates per-security daily MVs and adds the daily cash balance to produce
 * the total portfolio market value for every day in the period.
 */
function buildPortfolioTotalDailyMV(
  secResults: SecurityPerfInternal[],
  allTxs: TransactionWithUnits[],
  period: { start: string; end: string },
  depositAccIds?: Set<string>,
  fxContext?: {
    rateMaps: Map<string, RateMap>;
    secCurrencyMap: Map<string, string>;
    baseCurrency: string;
  },
  taxonomyWeights?: {
    securityWeights: Map<string, Decimal>;
    accountWeights: Map<string, Decimal>;
  },
): Map<string, Decimal> {
  const portfolioDailyMV = new Map<string, Decimal>();
  for (const sr of secResults) {
    const filled = carryForwardPrices(sr.dailyMV, period.start, period.end);
    const secCurrency = fxContext?.secCurrencyMap.get(sr.securityId) ?? fxContext?.baseCurrency;
    const secWeight = taxonomyWeights?.securityWeights.get(sr.securityId) ?? new Decimal(1);

    for (const [date, mv] of filled) {
      let convertedMV = mv.times(secWeight);
      if (fxContext && secCurrency && secCurrency !== fxContext.baseCurrency) {
        const rateMap = fxContext.rateMaps.get(secCurrency);
        const rate = rateMap ? getRateFromMap(rateMap, date) : null;
        if (rate) convertedMV = convertToBase(mv.times(secWeight), rate);
      }
      portfolioDailyMV.set(date, (portfolioDailyMV.get(date) ?? new Decimal(0)).plus(convertedMV));
    }
  }

  // For taxonomy scopes with per-account weights, compute cash per account and scale.
  // For non-taxonomy scopes, compute total cash across all deposit accounts (weight = 1).
  const total = new Map<string, Decimal>();
  if (taxonomyWeights && depositAccIds && depositAccIds.size > 0) {
    // Per-account weighted cash
    const perAccCash = new Map<string, Decimal>();
    for (const accId of depositAccIds) {
      const accTxs = (allTxs as PerfTransaction[]).filter(tx => tx.accountId === accId);
      const accCash = buildDailyCashMap(accTxs, period, new Set([accId]));
      const accWeight = taxonomyWeights.accountWeights.get(accId) ?? new Decimal(1);
      for (const [date, cash] of accCash) {
        perAccCash.set(date, (perAccCash.get(date) ?? new Decimal(0)).plus(cash.times(accWeight)));
      }
    }
    const filledSecMV = carryForwardPrices(portfolioDailyMV, period.start, period.end);
    for (const day of eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) })) {
      const dateStr = format(day, 'yyyy-MM-dd');
      total.set(dateStr,
        (filledSecMV.get(dateStr) ?? new Decimal(0)).plus(perAccCash.get(dateStr) ?? new Decimal(0)));
    }
  } else {
    const dailyCash = buildDailyCashMap(allTxs, period, depositAccIds);
    const filledSecMV = carryForwardPrices(portfolioDailyMV, period.start, period.end);
    for (const day of eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) })) {
      const dateStr = format(day, 'yyyy-MM-dd');
      total.set(dateStr,
        (filledSecMV.get(dateStr) ?? new Decimal(0)).plus(dailyCash.get(dateStr) ?? new Decimal(0)));
    }
  }
  return total;
}

// ─── Item helpers for breakdown ────────────────────────────────────────────────

function sumFeesForSecurity(txs: TransactionWithUnits[], period: { start: string; end: string }): Decimal {
  return txs
    .filter(tx => tx.date >= period.start && tx.date <= period.end)
    .reduce((sum, tx) => sum.plus(getFees(tx)), new Decimal(0));
}

function sumTaxesForSecurity(txs: TransactionWithUnits[], period: { start: string; end: string }): Decimal {
  return txs
    .filter(tx => tx.date >= period.start && tx.date <= period.end)
    .reduce((sum, tx) => sum.plus(getTaxes(tx)), new Decimal(0));
}

function fetchPntItems(
  sqlite: BetterSqlite3.Database,
  period: { start: string; end: string },
  accountNameMap: Map<string, string>,
): PntItem[] {
  // TRANSFER_IN/OUT with shares=0 or null are TRANSFER_BETWEEN_ACCOUNTS (not PNT).
  // Only include TRANSFER_IN/OUT when shares > 0 (real DELIVERY_INBOUND/OUTBOUND),
  // and exclude security transfers (portfolio-transfer cross-entry) which are internal movements.
  const rows = sqlite.prepare(
    `SELECT x.uuid, x.type, SUBSTR(x.date, 1, 10) AS date, x.amount, x.account
     FROM xact x
     WHERE (
       x.type IN ('DEPOSIT', 'REMOVAL')
       OR (x.type IN ('TRANSFER_IN', 'TRANSFER_OUT')
           AND COALESCE(x.shares, 0) > 0
           AND NOT EXISTS (
             SELECT 1 FROM xact_cross_entry ce
             WHERE ce.type = 'portfolio-transfer'
               AND (ce.from_xact = x.uuid OR ce.to_xact = x.uuid)
           ))
     )
       AND SUBSTR(x.date, 1, 10) >= ? AND SUBSTR(x.date, 1, 10) <= ?
     ORDER BY x.date ASC, x._order ASC, x._id ASC`,
  ).all(period.start, period.end) as Array<{
    uuid: string; type: string; date: string; amount: number | null; account: string;
  }>;

  const items: PntItem[] = [];
  for (const row of rows) {
    // Map ppxml2db type strings to our PNT type names
    let pntType: PntItem['type'];
    switch (row.type) {
      case 'DEPOSIT': pntType = 'DEPOSIT'; break;
      case 'REMOVAL': pntType = 'REMOVAL'; break;
      case 'TRANSFER_IN': pntType = 'DELIVERY_INBOUND'; break;
      case 'TRANSFER_OUT': pntType = 'DELIVERY_OUTBOUND'; break;
      default: continue; // skip unexpected types
    }

    const amount = convertAmountFromDb(row.amount);
    items.push({
      type: pntType,
      accountId: row.account,
      name: accountNameMap.get(row.account) ?? row.account,
      amount: amount.toString(),
      date: row.date,
    });
  }
  return items;
}

// ─── Scope filter for per-account / per-security / per-taxonomy calculations ─

/**
 * When provided, restricts the calculation to a subset of securities and accounts.
 * Used by the dashboard widget data-series feature (per-widget data series).
 */
export interface CalcScope {
  /** Only compute and aggregate these securities (early-skip in computeAllSecurities). */
  securityIds: Set<string>;
  /** Only include these deposit accounts for cash balance. Empty set = no cash component. */
  depositAccIds: Set<string>;
  /** Filter applied to allTxs for cashflows, PNT, standalone fees/taxes, daily cash map. */
  txFilter: (tx: PerfTransaction) => boolean;
  /** True when scope is taxonomy-based (needs deposit-level cashflow handling). */
  isTaxonomyScope?: boolean;
  /** Per-security weights (0–1 Decimal). Only set for taxonomy scopes. */
  securityWeights?: Map<string, Decimal>;
  /** Per-account weights (0–1 Decimal). Only set for taxonomy scopes. */
  accountWeights?: Map<string, Decimal>;
}

// ─── Helpers: resolve data-series filter → CalcScope ─────────────────────────

/** Security UUIDs that have at least one xact row in the given portfolio account. */
export function getSecurityIdsForAccount(
  sqlite: BetterSqlite3.Database,
  portfolioAccountId: string,
): Set<string> {
  const rows = sqlite.prepare(
    `SELECT DISTINCT security FROM xact WHERE account = ? AND security IS NOT NULL`,
  ).all(portfolioAccountId) as { security: string }[];
  return new Set(rows.map((r) => r.security));
}

/** Deposit (reference) account UUID for a portfolio account. */
export function getReferenceDepositAccountId(
  sqlite: BetterSqlite3.Database,
  portfolioAccountId: string,
): string | null {
  const row = sqlite.prepare(
    `SELECT referenceAccount FROM account WHERE uuid = ?`,
  ).get(portfolioAccountId) as { referenceAccount: string | null } | undefined;
  return row?.referenceAccount ?? null;
}

/** Security UUIDs assigned to a taxonomy (optionally narrowed to a specific category + descendants). */
export function getSecurityIdsForTaxonomy(
  sqlite: BetterSqlite3.Database,
  taxonomyId: string,
  categoryId?: string,
): Set<string> {
  if (categoryId) {
    // Include the category itself + all descendant categories (recursive CTE)
    const rows = sqlite.prepare(`
      WITH RECURSIVE descendants(uuid) AS (
        SELECT uuid FROM taxonomy_category WHERE uuid = ?
        UNION ALL
        SELECT tc.uuid FROM taxonomy_category tc
        JOIN descendants d ON tc.parent = d.uuid
      )
      SELECT DISTINCT ta.item AS security
      FROM taxonomy_assignment ta
      JOIN descendants d ON ta.category = d.uuid
      WHERE ta.item_type = 'security'
    `).all(categoryId) as { security: string }[];
    return new Set(rows.map((r) => r.security));
  }
  // All securities in any category of this taxonomy
  const rows = sqlite.prepare(`
    SELECT DISTINCT ta.item AS security
    FROM taxonomy_assignment ta
    WHERE ta.taxonomy = ? AND ta.item_type = 'security'
  `).all(taxonomyId) as { security: string }[];
  return new Set(rows.map((r) => r.security));
}

/** Deposit account UUIDs assigned to a taxonomy (optionally narrowed to a specific category + descendants). */
export function getAccountIdsForTaxonomy(
  sqlite: BetterSqlite3.Database,
  taxonomyId: string,
  categoryId?: string,
): Set<string> {
  if (categoryId) {
    const rows = sqlite.prepare(`
      WITH RECURSIVE descendants(uuid) AS (
        SELECT uuid FROM taxonomy_category WHERE uuid = ?
        UNION ALL
        SELECT tc.uuid FROM taxonomy_category tc
        JOIN descendants d ON tc.parent = d.uuid
      )
      SELECT DISTINCT ta.item AS account
      FROM taxonomy_assignment ta
      JOIN descendants d ON ta.category = d.uuid
      WHERE ta.item_type = 'account'
    `).all(categoryId) as { account: string }[];
    return new Set(rows.map((r) => r.account));
  }
  const rows = sqlite.prepare(`
    SELECT DISTINCT ta.item AS account
    FROM taxonomy_assignment ta
    WHERE ta.taxonomy = ? AND ta.item_type = 'account'
  `).all(taxonomyId) as { account: string }[];
  return new Set(rows.map((r) => r.account));
}

/** Returns per-item weights (0–1 Decimal) for a taxonomy category + descendants. */
export function getTaxonomyWeights(
  sqlite: BetterSqlite3.Database,
  taxonomyId: string,
  categoryId?: string,
): { securityWeights: Map<string, Decimal>; accountWeights: Map<string, Decimal> } {
  const sql = categoryId
    ? `WITH RECURSIVE descendants(uuid) AS (
         SELECT uuid FROM taxonomy_category WHERE uuid = ?
         UNION ALL
         SELECT tc.uuid FROM taxonomy_category tc JOIN descendants d ON tc.parent = d.uuid
       )
       SELECT ta.item, ta.item_type, ta.weight
       FROM taxonomy_assignment ta JOIN descendants d ON ta.category = d.uuid`
    : `SELECT ta.item, ta.item_type, ta.weight
       FROM taxonomy_assignment ta WHERE ta.taxonomy = ?`;
  const rows = sqlite.prepare(sql).all(categoryId ?? taxonomyId) as
    { item: string; item_type: string | null; weight: number | null }[];

  const securityWeights = new Map<string, Decimal>();
  const accountWeights = new Map<string, Decimal>();
  for (const r of rows) {
    const w = new Decimal(r.weight ?? 10000).div(10000);
    if (w.lte(0)) continue;
    const target = r.item_type === 'account' ? accountWeights : securityWeights;
    target.set(r.item, (target.get(r.item) ?? new Decimal(0)).plus(w));
  }
  return { securityWeights, accountWeights };
}

/** Build a CalcScope from the resolved filter parameters. */
export function buildCalcScope(
  sqlite: BetterSqlite3.Database,
  filter?: string,
  withReference?: boolean,
  taxonomyId?: string,
  categoryId?: string,
): CalcScope | undefined {
  // Account filter: filter is set AND withReference is explicitly defined
  if (filter && withReference !== undefined) {
    const securityIds = getSecurityIdsForAccount(sqlite, filter);
    const depositAccIds = new Set<string>();
    const accountIds = new Set<string>([filter]);
    if (withReference) {
      const refId = getReferenceDepositAccountId(sqlite, filter);
      if (refId) {
        depositAccIds.add(refId);
        accountIds.add(refId);
      }
    }
    return {
      securityIds,
      depositAccIds,
      txFilter: (tx) => accountIds.has(tx.accountId),
    };
  }

  // Security filter: filter is set, withReference is NOT defined
  if (filter) {
    return {
      securityIds: new Set([filter]),
      depositAccIds: new Set(),
      txFilter: (tx) => tx.securityId === filter,
    };
  }

  // Taxonomy filter
  if (taxonomyId) {
    const securityIds = getSecurityIdsForTaxonomy(sqlite, taxonomyId, categoryId);
    const depositAccIds = getAccountIdsForTaxonomy(sqlite, taxonomyId, categoryId);
    const { securityWeights, accountWeights } = getTaxonomyWeights(sqlite, taxonomyId, categoryId);
    return {
      securityIds,
      depositAccIds,
      isTaxonomyScope: true,
      securityWeights,
      accountWeights,
      txFilter: (tx) => {
        if (tx.securityId != null && securityIds.has(tx.securityId)) return true;
        if (depositAccIds.has(tx.accountId)) return true;
        return false;
      },
    };
  }

  return undefined; // No filter — full portfolio
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

/**
 * Converts a security-currency amount to base currency via period-end FX.
 * Returns null when the rate is unavailable — the caller filters unresolved.
 * Uses multiply convention: nativeAmount × rate = baseAmount.
 */
function toBaseAtDate(
  nativeAmount: Decimal,
  secCurrency: string,
  baseCurrency: string,
  rateMaps: Map<string, RateMap>,
  date: string,
): Decimal | null {
  if (secCurrency === baseCurrency) return nativeAmount;
  const rateMap = rateMaps.get(secCurrency);
  const rate = rateMap ? getRateFromMap(rateMap, date) : null;
  if (!rate) return null;
  return convertToBase(nativeAmount, rate);
}

/**
 * Per-security cost basis in base currency via per-lot FIFO consumption.
 *
 * Runs the engine's `computeFIFO` over the security's BUY/SELL/DELIVERY rows
 * (securities-side, `shares > 0`) and sums the surviving lots' `costInBase`.
 * Partial sells correctly drop their consumed-lot cost from the total — the
 * previous implementation summed ALL cash-side BUY rows and overstated cost
 * by the consumed portion (BUG: closed by Phase 3).
 *
 * Architecture: this replaces the old "sum every BUY cash-side row" helper
 * uniformly (same-ccy and cross-ccy alike). For same-ccy securities, FIFO
 * is run WITHOUT a `rateMap`; surviving lots' `totalCost` is already in
 * base ccy. For cross-ccy securities, FIFO is run WITH `rateMap`
 * (sec→base, multiply convention) and lots carry `costInBase = totalCost
 * × acquisitionRate`.
 *
 * Per-transaction gross in security currency is resolved via
 * `getSecurityCurrencyGross` (engine helper, single source of truth):
 *   1. tx.currencyCode === secCurrency → use tx amount directly.
 *   2. FOREX/GROSS_VALUE unit with fxCurrencyCode === secCurrency →
 *      use unit.fxAmount.
 *   3. Otherwise → unresolvable (return null).
 *
 * Returns null when:
 *   - Cross-ccy and `rateMaps` has no entry for `secCurrency`, OR
 *   - Engine's FIFO reports any BUY date with no rate
 *     (`unresolvedBuyDates` non-empty), OR
 *   - Any BUY tx has no resolvable gross in `secCurrency`
 *     (e.g. deposit-ccy BUY with no FOREX unit and no fallback rate).
 *
 * Caller treats null as "unresolved" and leaves the *Base fields as '0'.
 */
/**
 * Result of the per-lot FIFO pass over a single security's BUY/SELL/DELIVERY rows.
 *
 *   - `costBase` — surviving-lot cost in base ccy (caller's `costBase` field).
 *   - `fifoResult` — raw engine output, kept so callers can feed `consumedSlices`
 *     + `remainingLots` into `decomposeRealized` / `decomposeUnrealized` without
 *     re-running FIFO.
 *   - `costTxs` — the engine-shaped tx list FIFO consumed, in chronological
 *     order. Callers walking SELL slices need this to know which sell-date
 *     a particular slice was consumed by (consumedSlices carry no date).
 *
 * Returns null on any coverage gap (cross-ccy without rateMap, unresolvable
 * BUY date, BUY whose gross cannot be expressed in secCurrency).
 */
interface SecurityFifoInBase {
  costBase: Decimal;
  fifoResult: FIFOResult;
  costTxs: CostTransaction[];
}

function computeSecurityFifoInBase(
  txs: PerfTransaction[],
  securityId: string,
  secCurrency: string,
  baseCurrency: string,
  rateMaps: Map<string, RateMap>,
): SecurityFifoInBase | null {
  // For cross-ccy securities, run FIFO with the sec→base rateMap so lots
  // gain `costInBase`. For same-ccy securities, skip the rateMap so lots
  // carry `totalCost` directly (already in base ccy).
  const isCrossCcy = secCurrency !== baseCurrency;
  const rateMap = isCrossCcy ? rateMaps.get(secCurrency) : undefined;
  if (isCrossCcy && !rateMap) return null;

  // Build CostTransactions for FIFO. Only the securities-side rows feed FIFO
  // (BUY/SELL with shares > 0, plus DELIVERY_*). Cash-side BUY/SELL rows are
  // bookkeeping shadows in the same xact set and would double-count.
  const costTxs: CostTransaction[] = [];
  for (const t of txs) {
    if (t.securityId !== securityId) continue;
    const isBuy = t.type === TransactionType.BUY && (t.shares ?? 0) > 0;
    const isSell = t.type === TransactionType.SELL && (t.shares ?? 0) > 0;
    const isDeliveryIn = t.type === TransactionType.DELIVERY_INBOUND;
    const isDeliveryOut = t.type === TransactionType.DELIVERY_OUTBOUND;
    if (!isBuy && !isSell && !isDeliveryIn && !isDeliveryOut) continue;

    // Resolve gross in security currency. For SELL/DELIVERY_OUTBOUND with no
    // FX info we still need a numeric gross — the engine uses it only for
    // realized-gain math, not for surviving-lot cost (which is the BUY side).
    // Fall back to deposit-ccy gross when no FOREX unit exists.
    const grossSecCcy =
      getSecurityCurrencyGross(t, secCurrency) ??
      (isSell || isDeliveryOut ? getGrossAmount(t) : null);
    if (grossSecCcy == null) {
      // A BUY whose gross cannot be expressed in secCurrency cannot feed FIFO.
      return null;
    }

    costTxs.push({
      type: t.type as CostTransaction['type'],
      date: t.date,
      shares: new Decimal((t.shares ?? 0) / 1e8),
      grossAmount: grossSecCcy,
      fees: getFees(t),
    });
  }

  const result = computeFIFO(costTxs, undefined, undefined, rateMap ? { rateMap } : undefined);

  // Coverage check (cross-ccy only — same-ccy skips rateMap and never populates this).
  if (result.unresolvedBuyDates && result.unresolvedBuyDates.length > 0) return null;

  // Surviving lots' cost in base ccy:
  //   - Cross-ccy: lot.costInBase = lot.totalCost × acquisitionRate.
  //   - Same-ccy: lot.costInBase is undefined; lot.totalCost is in base ccy.
  let totalCostBase = new Decimal(0);
  for (const lot of result.remainingLots) {
    const lotBase = lot.costInBase ?? lot.totalCost;
    totalCostBase = totalCostBase.plus(lotBase);
  }
  return { costBase: totalCostBase, fifoResult: result, costTxs };
}

// ─── Phase 3 Task 8 — shared decomposition helper ────────────────────────────

/**
 * Per-security realized/unrealized capital/FX decomposition + dividend FX gain,
 * all in base ccy. Pure shared computation between `getSecurityPerformanceList`
 * (wire emission per security) and `getPortfolioCalc` (rollup accumulators).
 *
 * Returns `null` when no decomposition is computable for this security:
 *   - same-ccy (secCurrency === baseCurrency) — no FX component exists
 *   - cross-ccy with unresolved FIFO coverage (missing BUY-date rate in the
 *     wider cost-rate window)
 * Both cases mean the caller substitutes 0 for the 5 decomposition fields.
 *
 * The math itself is the lifted body of `getSecurityPerformanceList` lines
 * (formerly) 2585-2688: walks consumed slices per SELL, calls
 * `decomposeRealized` per SELL; calls `decomposeUnrealized` once on the
 * surviving lots at period.end; sums dividend × (endRate − receiptRate) per
 * in-period DIVIDEND tx in foreign currency.
 */
interface SecurityDecomposition {
  realizedCapitalBase: Decimal;
  realizedFxBase: Decimal;
  unrealizedCapitalBase: Decimal;
  unrealizedFxBase: Decimal;
  dividendFxBase: Decimal;
  /** FIFO result reused by caller (avoids re-running FIFO for costBase). */
  fifo: SecurityFifoInBase;
}

function computeSecurityDecomposition(
  sr: SecurityPerfInternal,
  nativeCurrency: string,
  baseCurrency: string,
  data: BatchData,
  rateMaps: Map<string, RateMap>,
  effectiveCostRateMaps: Map<string, RateMap>,
  period: { start: string; end: string },
): SecurityDecomposition | null {
  // Same-ccy short-circuit: no FX component exists anywhere.
  if (nativeCurrency === baseCurrency) return null;

  const fifo = computeSecurityFifoInBase(
    data.allTxs, sr.securityId, nativeCurrency, baseCurrency, effectiveCostRateMaps,
  );
  if (fifo === null) return null;

  let realizedCapitalBase = new Decimal(0);
  let realizedFxBase = new Decimal(0);
  let unrealizedCapitalBase = new Decimal(0);
  let unrealizedFxBase = new Decimal(0);
  let dividendFxBase = new Decimal(0);

  const slices = fifo.fifoResult.consumedSlices ?? [];
  const rateMap = effectiveCostRateMaps.get(nativeCurrency);
  // rateMap is guaranteed non-null here: fifo !== null implies the cross-ccy
  // branch resolved a rateMap. Keep the optional check to satisfy TS narrowing.
  if (rateMap) {
    // ─── Realized decomposition ──────────────────────────────────────────────
    let sliceIdx = 0;
    for (const ctx of fifo.costTxs) {
      const isSell = ctx.type === 'SELL' || ctx.type === 'DELIVERY_OUTBOUND';
      if (!isSell) continue;
      const sellRate = getRateFromMap(rateMap, ctx.date);
      // No sellRate → cannot decompose this SELL. Skip while still advancing
      // sliceIdx so subsequent SELLs read the correct slice range.
      if (!sellRate) {
        let unsettled = ctx.shares;
        while (unsettled.gt(0) && sliceIdx < slices.length) {
          const s = slices[sliceIdx];
          const consumed = Decimal.min(unsettled, s.shares);
          unsettled = unsettled.minus(consumed);
          if (consumed.eq(s.shares)) sliceIdx++;
          else slices[sliceIdx] = { ...s, shares: s.shares.minus(consumed) };
        }
        continue;
      }
      const sellPrice = ctx.shares.isZero()
        ? new Decimal(0)
        : ctx.grossAmount.div(ctx.shares);
      const sellSlices: typeof slices = [];
      let unsettled = ctx.shares;
      while (unsettled.gt(0) && sliceIdx < slices.length) {
        const s = slices[sliceIdx];
        const consumed = Decimal.min(unsettled, s.shares);
        sellSlices.push({ ...s, shares: consumed });
        unsettled = unsettled.minus(consumed);
        if (consumed.eq(s.shares)) sliceIdx++;
        else slices[sliceIdx] = { ...s, shares: s.shares.minus(consumed) };
      }
      const { capitalBase, forexBase } = decomposeRealized(sellSlices, sellPrice, sellRate);
      realizedCapitalBase = realizedCapitalBase.plus(capitalBase);
      realizedFxBase = realizedFxBase.plus(forexBase);
    }

    // ─── Unrealized decomposition ────────────────────────────────────────────
    const sharesEnd = sr.sharesEnd;
    if (sharesEnd.gt(0)) {
      const currentPrice = sr.mve.div(sharesEnd);
      const currentRate = getRateFromMap(rateMap, period.end);
      if (currentRate) {
        const { capitalBase: uCap, forexBase: uFx } = decomposeUnrealized(
          fifo.fifoResult.remainingLots, currentPrice, currentRate,
        );
        unrealizedCapitalBase = uCap;
        unrealizedFxBase = uFx;
      }
    }
  }

  // ─── Dividend FX gain ──────────────────────────────────────────────────────
  // For each in-period DIVIDEND tx of this security in foreign currency,
  // sum tx.amount × (endRate(depositCcy) − receiptRate(depositCcy)).
  for (const tx of data.allTxs) {
    if (tx.securityId !== sr.securityId) continue;
    if (tx.type !== TransactionType.DIVIDEND) continue;
    if (tx.date < period.start || tx.date > period.end) continue;
    if (tx.currencyCode == null || tx.currencyCode === baseCurrency) continue;
    if (tx.amount == null) continue;
    const divRateMap = rateMaps.get(tx.currencyCode);
    if (!divRateMap) continue;
    const receiptRate = getRateFromMap(divRateMap, tx.date);
    const endRate = getRateFromMap(divRateMap, period.end);
    if (!receiptRate || !endRate) continue;
    const fxDelta = new Decimal(tx.amount).mul(endRate.minus(receiptRate));
    dividendFxBase = dividendFxBase.plus(fxDelta);
  }

  return {
    realizedCapitalBase,
    realizedFxBase,
    unrealizedCapitalBase,
    unrealizedFxBase,
    dividendFxBase,
    fifo,
  };
}


// ─── Public API ───────────────────────────────────────────────────────────────

export function getPortfolioCalc(
  sqlite: BetterSqlite3.Database,
  period: { start: string; end: string },
  costMethod: CostMethod = CostMethod.MOVING_AVERAGE,
  preTax = true,
  includeItems = false,
  scope?: CalcScope,
): PortfolioCalcResult {
  const data = fetchBatchData(sqlite, period);

  // Item collection arrays (populated only when includeItems=true)
  const capitalGainItems: CapitalGainItem[] = [];
  const realizedGainItems: RealizedGainItem[] = [];
  const dividendItems: DividendItem[] = [];
  const feeItems: FeeItem[] = [];
  const taxItems: TaxItem[] = [];
  const cashCurrencyGainItems: CashCurrencyGainItem[] = [];

  const { baseCurrency, rateMaps } = buildFxContext(sqlite, data, period);

  // Phase 3 Task 8 — dedicated wider rateMaps for per-lot FIFO cost-basis,
  // mirroring getSecurityPerformanceList lines 2519-2538. Lots originate at
  // BUY dates which may predate period.start by years; the shared `rateMaps`
  // above is keyed on period.start (with a 30-day prefix only) and would
  // drop pre-period BUYs into `unresolvedBuyDates`. The widening is
  // forward-fill monotonic, so it only ADDS coverage. Kept local (not in
  // buildFxContext) because chart/heatmap/SoA paths intentionally want the
  // narrower window.
  const earliestTxDateForCost = data.allTxs.reduce<string | null>(
    (min, t) => (min == null || t.date < min ? t.date : min),
    null,
  );
  const costRateStart = earliestTxDateForCost && earliestTxDateForCost < period.start
    ? earliestTxDateForCost
    : period.start;
  const costRateMaps = new Map<string, RateMap>();
  if (costRateStart !== period.start) {
    for (const [ccy] of rateMaps) {
      costRateMaps.set(ccy, buildRateMap(sqlite, ccy, baseCurrency, costRateStart, period.end));
    }
  }
  const effectiveCostRateMaps = costRateMaps.size > 0 ? costRateMaps : rateMaps;

  // Compute per-security performance (skip non-scoped securities early for efficiency)
  // When account-scoped, also filter transactions within each security to only the scoped account,
  // so that MVB/MVE/daily-MV are consistent with the scoped cashflows.
  const secResults = computeAllSecurities(sqlite, data, period, costMethod, preTax, scope?.securityIds, scope?.txFilter);

  // Scoped transaction list (for cashflows, PNT, standalone fees/taxes, daily cash)
  const scopedTxs: PerfTransaction[] = scope
    ? data.allTxs.filter(scope.txFilter)
    : data.allTxs;

  // Scoped deposit account IDs (for cash balance)
  const scopedDepositAccIds = scope ? scope.depositAccIds : data.depositAccIds;

  // Aggregate. MVB/MVE include retired securities and retired deposit accounts
  // that still hold shares or have a non-zero balance — they're still the user's
  // property and must count toward NAV. Statement-of-assets uses the same rule,
  // so Dashboard / Investments / Allocation / Analytics-Calculation all agree,
  // and MVB + Σ components = MVE holds arithmetically (BUG-33 / BUG-34).
  let totalMVB = new Decimal(0);
  let totalMVE = new Decimal(0);
  let totalUnrealized = new Decimal(0);
  let totalRealized = new Decimal(0);
  let totalFxGains = new Decimal(0);
  let totalFees = new Decimal(0);
  let totalTaxes = new Decimal(0);
  let totalDividends = new Decimal(0);
  let totalInterest = new Decimal(0);
  let totalOpenPositionCost     = new Decimal(0);
  let totalOpenPositionValue    = new Decimal(0);
  let totalOpenPositionPnL      = new Decimal(0);
  let totalOpenPositionCostFifo = new Decimal(0);
  let totalOpenPositionPnLFifo  = new Decimal(0);

  // Phase 3 Task 8 — decomposition rollups: sum per-security trade-date-FX
  // decomposition fields (Task 7) into portfolio totals. These are ADDITIVE
  // to the existing totalRealized / totalUnrealized / totalDividends, which
  // intentionally use period-end-uniform FX and preserve existing UI numbers.
  let totalRealizedCapital   = new Decimal(0);
  let totalRealizedFx        = new Decimal(0);
  let totalUnrealizedCapital = new Decimal(0);
  let totalUnrealizedFx      = new Decimal(0);
  let totalDividendFx        = new Decimal(0);

  // Unresolved securities: those for which no FX rate is available at the
  // aggregation date. Excluded from rollup totals. Emitted on the wire shape
  // (`unresolvedCount` + `unresolvedSecurityIds`) for the UI's unresolved-FX badge.
  const unresolvedSecurityIds = new Set<string>();

  for (const sr of secResults) {
    const sw = scope?.securityWeights?.get(sr.securityId) ?? new Decimal(1);
    const secCcy = data.secCurrencyMap.get(sr.securityId) ?? baseCurrency;

    // Convert MVB/MVE to base currency at the respective period boundary.
    // When the rate is unavailable, skip this security from the entire rollup
    // rather than produce a mixed-unit sum (e.g. USD added as EUR).
    const mvbBase = toBaseAtDate(sr.mvb, secCcy, baseCurrency, rateMaps, period.start);
    const mveBase = toBaseAtDate(sr.mve, secCcy, baseCurrency, rateMaps, period.end);
    if (mvbBase === null || mveBase === null) {
      unresolvedSecurityIds.add(sr.securityId);
      continue;
    }

    const secTxs = data.txsBySecurity.get(sr.securityId) ?? [];

    // Convert remaining per-security totals to base at period-end.
    // Null-coalesce to Decimal(0) — these are secondary metrics, not NAV,
    // so a missing mid-period rate is a degraded-display case, not an exclusion.
    const unrealizedBase = toBaseAtDate(sr.unrealizedGain, secCcy, baseCurrency, rateMaps, period.end) ?? new Decimal(0);
    const realizedBase   = toBaseAtDate(sr.realizedGain,   secCcy, baseCurrency, rateMaps, period.end) ?? new Decimal(0);
    // dividends / fees / taxes are accumulated in DEPOSIT currency (the cash leg),
    // not in security currency. Convert each transaction at its receipt-date FX
    // rate so the panel reflects the cash actually received, not a period-end
    // re-projection (which double-counted the FX swing already in dividendFxBase).
    const dividendsBase  = sumAmountInBaseByType(secTxs, TransactionType.DIVIDEND, period, rateMaps, baseCurrency);
    const feesBase       = sumUnitAmountInBase(secTxs, 'FEE', period, rateMaps, baseCurrency);
    const taxesBase      = sumUnitAmountInBase(secTxs, 'TAX', period, rateMaps, baseCurrency);
    const openCostBase   = toBaseAtDate(sr.openPositionCost,     secCcy, baseCurrency, rateMaps, period.end) ?? new Decimal(0);
    const openValueBase  = toBaseAtDate(sr.openPositionValue,    secCcy, baseCurrency, rateMaps, period.end) ?? new Decimal(0);
    const openPnLBase    = toBaseAtDate(sr.openPositionPnL,      secCcy, baseCurrency, rateMaps, period.end) ?? new Decimal(0);
    const openCostFifo   = toBaseAtDate(sr.openPositionCostFifo, secCcy, baseCurrency, rateMaps, period.end) ?? new Decimal(0);
    const openPnLFifo    = toBaseAtDate(sr.openPositionPnLFifo,  secCcy, baseCurrency, rateMaps, period.end) ?? new Decimal(0);

    totalMVB = totalMVB.plus(mvbBase.times(sw));
    totalMVE = totalMVE.plus(mveBase.times(sw));
    totalUnrealized = totalUnrealized.plus(unrealizedBase.times(sw));
    totalRealized   = totalRealized.plus(realizedBase.times(sw));
    // foreignCurrencyGains is already in base currency: it is computed as
    // nativeCost × (currentRate − purchaseRate) inside computeCurrencyGains,
    // which uses the multiply-convention rate (native→base). No further
    // conversion needed — adding it directly is correct.
    totalFxGains    = totalFxGains.plus(sr.foreignCurrencyGains.times(sw));
    totalFees       = totalFees.plus(feesBase.times(sw));
    totalTaxes      = totalTaxes.plus(taxesBase.times(sw));
    totalDividends  = totalDividends.plus(dividendsBase);
    totalOpenPositionCost     = totalOpenPositionCost.plus(openCostBase.times(sw));
    totalOpenPositionValue    = totalOpenPositionValue.plus(openValueBase.times(sw));
    totalOpenPositionPnL      = totalOpenPositionPnL.plus(openPnLBase.times(sw));
    totalOpenPositionCostFifo = totalOpenPositionCostFifo.plus(openCostFifo.times(sw));
    totalOpenPositionPnLFifo  = totalOpenPositionPnLFifo.plus(openPnLFifo.times(sw));

    // Phase 3 Task 8 — decomposition accumulators (per-tx trade-date FX).
    // The decomposition lives on SecurityPerfResult (wire shape), not on
    // SecurityPerfInternal. computeSecurityDecomposition is the shared helper
    // that both this rollup and getSecurityPerformanceList consume. Skips
    // gracefully (returns null) for same-ccy securities and coverage gaps;
    // we treat those as zero contribution.
    const decomp = computeSecurityDecomposition(
      sr, secCcy, baseCurrency, data, rateMaps, effectiveCostRateMaps, period,
    );
    if (decomp !== null) {
      // Weight applied symmetrically with the legacy aggregates, EXCEPT
      // dividendFxBase which mirrors totalDividends' weight-less posture
      // (line `totalDividends.plus(dividendsBase)` above) for consistency on
      // scoped queries.
      totalRealizedCapital   = totalRealizedCapital.plus(decomp.realizedCapitalBase.times(sw));
      totalRealizedFx        = totalRealizedFx.plus(decomp.realizedFxBase.times(sw));
      totalUnrealizedCapital = totalUnrealizedCapital.plus(decomp.unrealizedCapitalBase.times(sw));
      totalUnrealizedFx      = totalUnrealizedFx.plus(decomp.unrealizedFxBase.times(sw));
      totalDividendFx        = totalDividendFx.plus(decomp.dividendFxBase);
    }

    if (includeItems) {
      const secInfo = data.securityInfoMap.get(sr.securityId);
      const secName = secInfo?.name ?? sr.securityId;
      const secIsin = secInfo?.isin;
      // Capital gain item (unrealized gains per security).
      // Exclude fully-sold securities (mve=0 and no unrealized gain) — they belong
      // only in realizedGains.items.
      if (!sr.mve.isZero() || !sr.unrealizedGain.isZero()) {
        capitalGainItems.push({
          securityId: sr.securityId,
          name: secName,
          isin: secIsin,
          unrealizedGain: sr.unrealizedGain.toString(),
          foreignCurrencyGains: sr.foreignCurrencyGains.toString(),
          initialValue: sr.mvb.toString(),
          finalValue: sr.mve.toString(),
        });
      }

      // Realized gain item
      if (!sr.realizedGain.isZero()) {
        // Derive proceeds from SELL/DELIVERY_OUTBOUND in period
        const sellTxs = secTxs.filter(
          tx => tx.date >= period.start && tx.date <= period.end &&
            (tx.type === TransactionType.SELL || tx.type === TransactionType.DELIVERY_OUTBOUND) &&
            tx.shares != null && tx.shares > 0,
        );
        const proceeds = sellTxs.reduce((sum, tx) => sum.plus(getGrossAmount(tx)), new Decimal(0));
        const costAtPeriodStart = proceeds.minus(sr.realizedGain);
        realizedGainItems.push({
          securityId: sr.securityId,
          name: secName,
          isin: secIsin,
          realizedGain: sr.realizedGain.toString(),
          proceeds: proceeds.toString(),
          costAtPeriodStart: costAtPeriodStart.toString(),
        });
      }

      // Dividend item
      if (!sr.dividends.isZero()) {
        dividendItems.push({
          securityId: sr.securityId,
          name: secName,
          isin: secIsin,
          dividends: sr.dividends.toString(),
        });
      }

      // Fee item for this security
      const secFees = sumFeesForSecurity(secTxs, period);
      if (!secFees.isZero()) {
        feeItems.push({
          securityId: sr.securityId,
          name: secName,
          fees: secFees.toString(),
        });
      }

      // Tax item for this security (only when not preTax)
      if (!preTax) {
        const secTaxes = sumTaxesForSecurity(secTxs, period);
        if (!secTaxes.isZero()) {
          taxItems.push({
            securityId: sr.securityId,
            name: secName,
            taxes: secTaxes.toString(),
          });
        }
      }
    }
  }

  // Interest is calculated directly from allTxs because INTEREST transactions
  // are linked only to deposit accounts (no securityId), so they are
  // never included in per-security results.
  // Earnings = dividends + net interest (Interest - Interest Charge).
  const grossInterest = sumGrossEarningsByType(scopedTxs, TransactionType.INTEREST, period);
  const interestCharge = sumGrossEarningsByType(scopedTxs, TransactionType.INTEREST_CHARGE, period);
  totalInterest = grossInterest.minus(interestCharge);

  // Transactions without securityId are not part of any per-security calculation.
  // Their TAX/FEE units (e.g., withholding tax on INTEREST) and standalone
  // TAXES/TAX_REFUND amounts must be aggregated separately.
  // sumUnitTypeInPeriod handles both: TAX units first, then TAXES/TAX_REFUND fallback.
  const standaloneTxs = scopedTxs.filter(tx => !tx.securityId);
  if (!preTax) {
    totalTaxes = totalTaxes.plus(sumUnitTypeInPeriod(standaloneTxs, 'TAX', period));
  }

  // Same pattern for fees: sumUnitTypeInPeriod handles FEE units + FEES/FEES_REFUND fallback.
  totalFees = totalFees.plus(sumUnitTypeInPeriod(standaloneTxs, 'FEE', period));

  // Standalone fee/tax items (transactions without a securityId)
  if (includeItems) {
    for (const tx of standaloneTxs) {
      if (tx.date < period.start || tx.date > period.end) continue;
      const perfTx = tx as PerfTransaction;
      const accountName = data.accountNameMap.get(perfTx.accountId) ?? perfTx.accountId;

      if (tx.type === TransactionType.FEES) {
        const feeAmt = getFees(tx);
        // Standalone FEES without xact_unit FEE rows: use xact.amount
        const amount = feeAmt.isZero() ? new Decimal(tx.amount ?? 0) : feeAmt;
        if (!amount.isZero()) {
          feeItems.push({ securityId: undefined, name: accountName, fees: amount.toString() });
        }
      } else if (tx.type === TransactionType.FEES_REFUND) {
        const feeAmt = getFees(tx);
        const amount = feeAmt.isZero() ? new Decimal(tx.amount ?? 0) : feeAmt;
        if (!amount.isZero()) {
          // FEES_REFUND: negate because it's a refund (reduces total fees)
          feeItems.push({ securityId: undefined, name: accountName, fees: amount.negated().toString() });
        }
      }

      if (!preTax) {
        if (tx.type === TransactionType.TAXES) {
          const taxAmt = getTaxes(tx);
          const amount = taxAmt.isZero() ? new Decimal(tx.amount ?? 0) : taxAmt;
          if (!amount.isZero()) {
            taxItems.push({ securityId: undefined, name: accountName, taxes: amount.toString() });
          }
        } else if (tx.type === TransactionType.TAX_REFUND) {
          const taxAmt = getTaxes(tx);
          const amount = taxAmt.isZero() ? new Decimal(tx.amount ?? 0) : taxAmt;
          if (!amount.isZero()) {
            // TAX_REFUND: negate because it's a refund (reduces total taxes)
            taxItems.push({ securityId: undefined, name: accountName, taxes: amount.negated().toString() });
          }
        }
      }
    }
  }

  const taxonomyWeights = scope?.isTaxonomyScope && scope.securityWeights && scope.accountWeights
    ? { securityWeights: scope.securityWeights, accountWeights: scope.accountWeights }
    : undefined;
  const portfolioTotalDailyMV = buildPortfolioTotalDailyMV(
    secResults, scopedTxs, period, scopedDepositAccIds,
    { rateMaps, secCurrencyMap: data.secCurrencyMap, baseCurrency },
    taxonomyWeights,
  );

  // Use direct SQL balance queries (correctly handles TRANSFER_IN/OUT unlike buildDailyCashMap).
  // Convert each deposit account's balance to base currency before summing.
  // For taxonomy scopes, apply per-account weights after conversion.
  if (scope?.accountWeights && scope.accountWeights.size > 0) {
    for (const accId of scopedDepositAccIds) {
      const aw = scope.accountWeights.get(accId) ?? new Decimal(1);
      const accCurrency = data.depositAccCurrencyMap.get(accId) ?? baseCurrency;
      let balStart = fetchDepositCashBalance(sqlite, new Set([accId]), period.start);
      let balEnd = fetchDepositCashBalance(sqlite, new Set([accId]), period.end);
      if (accCurrency !== baseCurrency) {
        const rateMap = rateMaps.get(accCurrency);
        const rStart = rateMap ? getRateFromMap(rateMap, period.start) : null;
        const rEnd = rateMap ? getRateFromMap(rateMap, period.end) : null;
        if (rStart) balStart = convertToBase(balStart, rStart);
        if (rEnd) balEnd = convertToBase(balEnd, rEnd);
        if (!rStart || !rEnd) {
          console.warn(`[multi-currency] deposit ${accId} (${accCurrency}) → ${baseCurrency} missing rate at period boundary; balance left in native ccy`);
        }
      }
      totalMVB = totalMVB.plus(balStart.times(aw));
      totalMVE = totalMVE.plus(balEnd.times(aw));
    }
  } else {
    for (const accId of scopedDepositAccIds) {
      const accCurrency = data.depositAccCurrencyMap.get(accId) ?? baseCurrency;
      let balStart = fetchDepositCashBalance(sqlite, new Set([accId]), period.start);
      let balEnd = fetchDepositCashBalance(sqlite, new Set([accId]), period.end);
      if (accCurrency !== baseCurrency) {
        const rateMap = rateMaps.get(accCurrency);
        const rStart = rateMap ? getRateFromMap(rateMap, period.start) : null;
        const rEnd = rateMap ? getRateFromMap(rateMap, period.end) : null;
        if (rStart) balStart = convertToBase(balStart, rStart);
        if (rEnd) balEnd = convertToBase(balEnd, rEnd);
        if (!rStart || !rEnd) {
          console.warn(`[multi-currency] deposit ${accId} (${accCurrency}) → ${baseCurrency} missing rate at period boundary; balance left in native ccy`);
        }
      }
      totalMVB = totalMVB.plus(balStart);
      totalMVE = totalMVE.plus(balEnd);
    }
  }

  // Cash FX gains — compute for each foreign deposit account in scope
  let totalCashFxGains = new Decimal(0);
  for (const accId of scopedDepositAccIds) {
    const accCurrency = data.depositAccCurrencyMap.get(accId) ?? baseCurrency;
    if (accCurrency !== baseCurrency) {
      const rateMap = rateMaps.get(accCurrency);
      if (rateMap) {
        const rStart = getRateFromMap(rateMap, period.start);
        const rEnd = getRateFromMap(rateMap, period.end);
        if (rStart && rEnd) {
          const balance = fetchDepositCashBalance(sqlite, new Set([accId]), period.end);
          const gain = computeCashCurrencyGain(balance, rStart, rEnd);
          totalCashFxGains = totalCashFxGains.plus(gain);
          if (includeItems && !gain.isZero()) {
            cashCurrencyGainItems.push({
              accountId: accId,
              name: data.accountNameMap.get(accId) ?? accId,
              currency: accCurrency,
              gain: gain.toString(),
            });
          }
        }
      }
    }
  }

  // Portfolio TTWROR (uses total MV including cash)
  const periodDays = differenceInCalendarDays(parseISO(period.end), parseISO(period.start));

  // For security-only scopes (taxonomy, individual security), use security-level cashflows
  // (BUY/SELL/DIVIDEND/DELIVERY) instead of portfolio-level (DEPOSIT/REMOVAL/DELIVERY).
  // Portfolio-level cashflows don't apply: scopedTxs has no DEPOSIT/REMOVAL (no securityId).
  // Without this, TTWROR treats BUY-day MV jumps as returns, and IRR can't converge when mvb=0.
  const isSecurityOnlyScope = scope && scope.depositAccIds.size === 0 && scope.securityIds.size > 0;
  const isTaxonomyScopeWithDeposits = scope?.isTaxonomyScope && scope.depositAccIds.size > 0;

  let portfolioCashflows: Cashflow[];
  if (isSecurityOnlyScope) {
    portfolioCashflows = buildSecurityOnlyCashflows(
      scopedTxs, data.allTxs, scope, period,
    );
  } else if (isTaxonomyScopeWithDeposits) {
    // Taxonomy scope with deposit accounts: combine security-level + deposit-level cashflows.
    // Security CFs scaled by security weight, deposit CFs scaled by account weight.
    portfolioCashflows = secResults.flatMap((sr) => {
      const sw = scope.securityWeights?.get(sr.securityId) ?? new Decimal(1);
      const secTxs = data.txsBySecurity.get(sr.securityId) ?? [];
      return resolveSecurityCashflows(secTxs, sr.securityId, !preTax)
        .map(cf => ({ ...cf, amount: cf.amount.times(sw) }));
    });
    for (const accId of scope.depositAccIds) {
      const aw = scope.accountWeights?.get(accId) ?? new Decimal(1);
      const accTxs = scopedTxs.filter(tx => tx.accountId === accId);
      for (const tx of accTxs) {
        if (tx.date < period.start || tx.date > period.end) continue;
        const gross = new Decimal(tx.amount ?? 0).times(aw);
        switch (tx.type) {
          case TransactionType.DEPOSIT:
          case TransactionType.SELL:
          case TransactionType.TAX_REFUND:
            portfolioCashflows.push({ date: tx.date, amount: gross, type: tx.type });
            break;
          case TransactionType.REMOVAL:
          case TransactionType.BUY:
          case TransactionType.TAXES:
            portfolioCashflows.push({ date: tx.date, amount: gross.negated(), type: tx.type });
            break;
          case TransactionType.FEES:
            // PP §3.4: FEES with non-categorized security → REMOVAL (transferal).
            // FEES with no security or categorized security → FEES (cost, NOT transferal).
            if (tx.securityId && !scope.securityIds.has(tx.securityId)) {
              portfolioCashflows.push({ date: tx.date, amount: gross.negated(), type: tx.type });
            }
            // else: cost — affects MV but is NOT a transferal
            break;
          case TransactionType.FEES_REFUND:
            // Symmetric: non-categorized security → DEPOSIT (transferal). Otherwise cost.
            if (tx.securityId && !scope.securityIds.has(tx.securityId)) {
              portfolioCashflows.push({ date: tx.date, amount: gross, type: tx.type });
            }
            break;
          // INTEREST_CHARGE: PP keeps as cost (NOT a transferal). Affects MV only.
          case TransactionType.INTEREST: {
            // PP §3.4: grosses up INTEREST by taxes and creates a REMOVAL for the tax amount.
            const interestTax = getTaxes(tx).times(aw);
            if (!interestTax.isZero()) {
              portfolioCashflows.push({ date: tx.date, amount: interestTax.negated(), type: TransactionType.TAXES });
            }
            break;
          }
          case TransactionType.INTEREST_CHARGE: {
            // PP §3.4: same gross-up pattern. Taxes → REMOVAL.
            const ichargeTax = getTaxes(tx).times(aw);
            if (!ichargeTax.isZero()) {
              portfolioCashflows.push({ date: tx.date, amount: ichargeTax.negated(), type: TransactionType.TAXES });
            }
            break;
          }
          case TransactionType.DIVIDEND:
            // Dividends from securities NOT in this taxonomy slice are external inflows
            // (attributed to the security's category, not Cash). Neutralise them.
            // Dividends from slice securities are already handled at the security level.
            if (tx.securityId && !scope.securityIds.has(tx.securityId)) {
              portfolioCashflows.push({ date: tx.date, amount: gross, type: tx.type });
            }
            break;
          case TransactionType.TRANSFER_BETWEEN_ACCOUNTS: {
            // Cash transfers between accounts: neutralise so they don't affect TTWROR.
            const transferAmount = (tx as PerfTransaction).isTransferOut ? gross.negated() : gross;
            portfolioCashflows.push({ date: tx.date, amount: transferAmount, type: tx.type });
            break;
          }
        }
      }
    }
  } else {
    // Full portfolio or account scope: project scoped txs to base ccy before
    // cashflow resolution so DEPOSIT/REMOVAL amounts are unit-consistent with
    // the base-ccy MVB/MVE produced by the aggregation loop above.
    const { projectedTxs: projectedScopedTxs, unresolvedSecurityIds: unresolvedFromCashflows } =
      projectTransactionsToBaseCurrency(scopedTxs, baseCurrency, rateMaps);
    for (const id of unresolvedFromCashflows) unresolvedSecurityIds.add(id);
    portfolioCashflows = resolvePortfolioCashflows(projectedScopedTxs);

    if (scope && !scope.isTaxonomyScope) {
      appendTransferCashflows(portfolioCashflows, projectedScopedTxs, period);
    }
  }

  const snapshots = buildDailySnapshotsWithCarry(portfolioCashflows, portfolioTotalDailyMV, period);
  const ttwrorResult = computeTTWROR(snapshots, periodDays);

  // Portfolio IRR — exclude start-day cashflows because MVB already includes
  // their effect (end-of-day balance). Including them would double-count.
  const inPeriodCFs = portfolioCashflows.filter(
    (cf) => cf.date > period.start && cf.date <= period.end,
  );
  const irrResult = computeIRR({
    mvb: totalMVB,
    mve: totalMVE,
    cashflows: inPeriodCFs,
    periodStart: period.start,
    periodEnd: period.end,
  });

  // Performance-neutral transfers (scoped to relevant transactions)
  const deposits = sumByTypeInPeriod(scopedTxs, TransactionType.DEPOSIT, period);
  const removals = sumByTypeInPeriod(scopedTxs, TransactionType.REMOVAL, period);
  const deliveryIn = sumByTypeInPeriod(scopedTxs, TransactionType.DELIVERY_INBOUND, period);
  const deliveryOut = sumByTypeInPeriod(scopedTxs, TransactionType.DELIVERY_OUTBOUND, period);
  // In preTax mode, taxes are excluded from earnings and included in PNT instead.
  // This includes both TAX units on security transactions and standalone TAXES/TAX_REFUND.
  // sumUnitTypeInPeriod('TAX') already includes standalone TAXES/TAX_REFUND amounts
  // via its fallback (when no xact_unit TAX rows exist). Do NOT add sumByTypeInPeriod
  // for TAXES/TAX_REFUND again — that would double-count them.
  const taxesForTransfers = preTax
    ? sumUnitTypeInPeriod(scopedTxs, 'TAX', period)
    : new Decimal(0);
  const performanceNeutralTransfers = deposits.plus(deliveryIn).minus(removals).minus(deliveryOut).minus(taxesForTransfers);

  const absoluteChange = totalMVE.minus(totalMVB); // MVE - MVB (includes retired)
  const deltaValue = totalMVE.minus(totalMVB).minus(performanceNeutralTransfers);
  const investedCapital = totalMVB.plus(performanceNeutralTransfers);
  const delta = investedCapital.gt(0) ? deltaValue.div(investedCapital) : new Decimal(0);
  const totalEarnings = totalDividends.plus(totalInterest);
  const totalCapitalGains = totalUnrealized.plus(totalFxGains);

  // Maximum Drawdown
  const mddResult = computeMaxDrawdown(
    ttwrorResult.dailyReturns.map((dr) => ({
      date: dr.date,
      cumulativeReturn: dr.cumR,
    })),
  );

  // Volatility / Semivariance / Sharpe Ratio
  // Filter to trading days (exclude weekends).
  // Day-of-week from ISO string avoids N parseISO allocations: 0=Sun, 6=Sat.
  const tradingDayReturns = ttwrorResult.dailyReturns.filter((dr) => {
    const dow = new Date(dr.date + 'T12:00:00').getDay();
    return dow !== 0 && dow !== 6;
  });
  const volResult = computeVolatility(tradingDayReturns);
  const sharpeRatio = irrResult !== null && volResult.volatility !== null
    ? computeSharpeRatio(irrResult, volResult.volatility, new Decimal(0))
    : null;

  const absPerf = computeAbsolutePerformance({
    mvb: totalMVB,
    mve: totalMVE,
    cfIn: deposits.plus(deliveryIn),
    cfOut: removals.plus(deliveryOut),
  });

  // PNT items (individual transactions)
  const pntItems = includeItems ? fetchPntItems(sqlite, period, data.accountNameMap) : [];

  return {
    baseCurrency,
    unresolvedCount: unresolvedSecurityIds.size,
    unresolvedSecurityIds: [...unresolvedSecurityIds],
    initialValue: totalMVB.toString(),
    capitalGains: {
      unrealized: totalUnrealized.toString(),
      realized: totalRealized.toString(),
      foreignCurrencyGains: totalFxGains.toString(),
      total: totalCapitalGains.toString(),
      items: capitalGainItems,
    },
    realizedGains: {
      total: totalRealized.toString(),
      items: realizedGainItems,
    },
    earnings: {
      dividends: totalDividends.toString(),
      interest: totalInterest.toString(),
      total: totalEarnings.toString(),
      dividendItems,
    },
    fees: {
      total: totalFees.toString(),
      items: feeItems,
    },
    taxes: {
      total: totalTaxes.toString(),
      items: taxItems,
    },
    cashCurrencyGains: {
      total: totalCashFxGains.toString(),
      items: cashCurrencyGainItems,
    },
    performanceNeutralTransfers: {
      deposits: deposits.toString(),
      removals: removals.toString(),
      deliveryInbound: deliveryIn.toString(),
      deliveryOutbound: deliveryOut.toString(),
      taxes: taxesForTransfers.toString(),
      total: performanceNeutralTransfers.toString(),
      items: pntItems,
    },
    finalValue: totalMVE.toString(),
    irr: irrResult?.toString() ?? null,
    irrConverged: irrResult !== null,
    irrError: null,
    ttwror: ttwrorResult.cumulative.toString(),
    ttwrorPa: ttwrorResult.annualized.toString(),
    absoluteChange: absoluteChange.toString(),
    deltaValue: deltaValue.toString(),
    delta: delta.toString(),
    absolutePerformance: absPerf.value.toString(),
    absolutePerformancePct: absPerf.percentage.toString(),
    maxDrawdown: mddResult.maxDrawdown.toString(),
    currentDrawdown: mddResult.currentDrawdown.toString(),
    maxDrawdownPeakDate: mddResult.peakDate,
    maxDrawdownTroughDate: mddResult.troughDate,
    maxDrawdownDuration: mddResult.maxDrawdownDuration,
    volatility: volResult.volatility?.toString() ?? null,
    semivariance: volResult.semivariance?.toString() ?? null,
    sharpeRatio: sharpeRatio?.toString() ?? null,
    openPositionPnL: (() => {
      const pnlPct = totalOpenPositionCost.gt(0)
        ? totalOpenPositionPnL.div(totalOpenPositionCost)
        : new Decimal(0);
      const fifoMv = totalOpenPositionCostFifo.gt(0)
        ? totalOpenPositionPnLFifo.div(totalOpenPositionCostFifo)
        : new Decimal(0);
      return {
        value:       totalOpenPositionPnL.toString(),
        percentage:  pnlPct.toString(),
        cost:        totalOpenPositionCost.toString(),
        marketValue: totalOpenPositionValue.toString(),
        fifo: {
          value:      totalOpenPositionPnLFifo.toString(),
          percentage: fifoMv.toString(),
          cost:       totalOpenPositionCostFifo.toString(),
        },
      };
    })(),
    // Phase 3 Task 8 — decomposition rollups (per-tx trade-date FX, base ccy).
    realizedCapitalBase:   totalRealizedCapital.toString(),
    realizedFxBase:        totalRealizedFx.toString(),
    unrealizedCapitalBase: totalUnrealizedCapital.toString(),
    unrealizedFxBase:      totalUnrealizedFx.toString(),
    dividendFxBase:        totalDividendFx.toString(),
  };
}

/**
 * Second TTWROR/IRR pass for a single security, projected to base currency.
 *
 * The "native" pass in `computeSecurityPerfInternal` answers "what did this
 * security do as a holder of its native currency?". The base pass answers
 * "what did this security do as an investor in the portfolio's base
 * currency?" — capital and FX moves combined.
 *
 *   dailyMV_base[date]    = dailyMV_native[date] × rate(date)
 *   cashflows_base        = resolveSecurityCashflows(baseProjectedSecTxs, …)
 *
 * Same-ccy short-circuit lives in the caller (no FX → both passes coincide).
 *
 * Returns `null` on coverage gap (no rateMap for nativeCurrency, OR every day
 * lacks a rate so projected MV is empty). Caller substitutes the native pass.
 */
interface BasePerfResult {
  ttwror: Decimal;
  ttwrorPa: Decimal;
  irr: Decimal | null;
}

function computeSecurityPerfInBase(
  sr: SecurityPerfInternal,
  nativeCurrency: string,
  baseCurrency: string,
  rawSecTxs: PerfTransaction[],
  rateMaps: Map<string, RateMap>,
  period: { start: string; end: string },
): BasePerfResult | null {
  const rateMap = rateMaps.get(nativeCurrency);
  if (!rateMap) return null;

  // Project daily MV from sec ccy → base. Days without a rate are dropped;
  // `buildDailySnapshotsWithCarry` then fills via carry-forward of the last
  // known base-ccy MV (semantically: assume the rate held when no fresh quote).
  const dailyMVBase = new Map<string, Decimal>();
  for (const [date, mv] of sr.dailyMV) {
    const rate = getRateFromMap(rateMap, date);
    if (rate) dailyMVBase.set(date, convertToBase(mv, rate));
  }
  if (dailyMVBase.size === 0) return null;

  // Cashflows: project raw deposit-ccy txs to base, then resolve security
  // cashflows. The raw tx set deliberately predates per-security-currency
  // projection (which is what feeds the native pass) — we want base ccy,
  // not security ccy. Use `false` for includeTaxes to mirror the native pass.
  const { projectedTxs: baseTxs } = projectTransactionsToBaseCurrency(
    rawSecTxs,
    baseCurrency,
    rateMaps,
  );
  const cashflows = resolveSecurityCashflows(baseTxs, sr.securityId, false);

  const snapshots = buildDailySnapshotsWithCarry(cashflows, dailyMVBase, period);
  const periodDays = differenceInCalendarDays(parseISO(period.end), parseISO(period.start));
  const ttwrorResult = computeTTWROR(snapshots, periodDays);

  // IRR: MVB/MVE in base from the snapshot edges; in-period cashflows only
  // (mirror the native pass — see computeSecurityPerfInternal lines 883-892).
  const filledBase = carryForwardPrices(dailyMVBase, period.start, period.end);
  const mvbBase = filledBase.get(period.start) ?? new Decimal(0);
  const mveBase = filledBase.get(period.end) ?? new Decimal(0);
  const inPeriodCFs = cashflows.filter(
    (cf) => cf.date > period.start && cf.date <= period.end,
  );
  const irrBase = computeIRR({
    mvb: mvbBase,
    mve: mveBase,
    cashflows: inPeriodCFs,
    periodStart: period.start,
    periodEnd: period.end,
  });

  return {
    ttwror: ttwrorResult.cumulative,
    ttwrorPa: ttwrorResult.annualized,
    irr: irrBase,
  };
}

export function getSecurityPerformanceList(
  sqlite: BetterSqlite3.Database,
  period: { start: string; end: string },
  costMethod: CostMethod = CostMethod.MOVING_AVERAGE,
  preTax = true,
): SecurityPerfResult[] {
  const data = fetchBatchData(sqlite, period);
  const secResults = computeAllSecurities(sqlite, data, period, costMethod, preTax);
  const { baseCurrency, rateMaps } = buildFxContext(sqlite, data, period);

  // Dedicated wider rateMaps for per-lot FIFO cost-basis: lots originate at
  // BUY dates which may predate period.start by years. The shared `rateMaps`
  // above is keyed on `period.start` (with a 30-day prefix only); using it for
  // FIFO drops every pre-period BUY into `unresolvedBuyDates`. We rebuild
  // here from min(period.start, earliestTxDate) → period.end. The forward-fill
  // is monotonic so widening only ADDS coverage, never alters previously-
  // resolved rates. Kept local (not in buildFxContext) so chart/heatmap/SoA
  // consumers retain their period-anchored windows.
  const earliestTxDate = data.allTxs.reduce<string | null>(
    (min, t) => (min == null || t.date < min ? t.date : min),
    null,
  );
  const costRateStart = earliestTxDate && earliestTxDate < period.start ? earliestTxDate : period.start;
  const costRateMaps = new Map<string, RateMap>();
  if (costRateStart !== period.start) {
    for (const [ccy] of rateMaps) {
      costRateMaps.set(ccy, buildRateMap(sqlite, ccy, baseCurrency, costRateStart, period.end));
    }
  }
  const effectiveCostRateMaps = costRateMaps.size > 0 ? costRateMaps : rateMaps;

  return secResults.map((sr) => {
    const nativeCurrency = data.secCurrencyMap.get(sr.securityId) ?? baseCurrency;

    // *Base fields: same-currency → native value; cross-currency → FX projection.
    // costBase uses per-tx trade-date FX (strict upstream); other *Base fields use
    // period-end FX (statement-date snapshot), matching getPortfolioCalc lines 1703-1712.
    let marketValueBase: string;
    let costBase: string;
    let unrealizedBase: string;
    let realizedBase: string;
    let dividendsBase: string;

    // Decomposition (5 fields) + dual-perf (4 fields). Both default to '0' /
    // native short-circuit; populated only when the FIFO+FX coverage holds.
    let realizedCapitalBase = '0';
    let realizedFxBase = '0';
    let unrealizedCapitalBase = '0';
    let unrealizedFxBase = '0';
    let dividendFxBase = '0';
    let ttwrorBase = sr.ttwror.toString();
    let ttwrorPaBase = sr.ttwrorPa.toString();
    let irrBase: string | null = sr.irr?.toString() ?? null;
    let irrBaseConverged = sr.irr !== null;

    if (nativeCurrency === baseCurrency) {
      // Same-ccy short-circuit. No FX component anywhere — decomposition fields
      // stay '0' and dual-perf fields keep the native pass values set above.
      marketValueBase = sr.mve.toString();
      costBase = sr.purchaseValue.toString();
      unrealizedBase = sr.unrealizedGain.toString();
      realizedBase = sr.realizedGain.toString();
      dividendsBase = sr.dividends.toString();
    } else {
      // Cross-ccy: delegate to the shared helper. It runs FIFO once + computes
      // all 5 decomposition fields. Returns null on coverage gap; the caller
      // also needs `fifo.costBase` to set the legacy `costBase` field.
      const decomp = computeSecurityDecomposition(
        sr, nativeCurrency, baseCurrency, data, rateMaps, effectiveCostRateMaps, period,
      );
      const mveBase = toBaseAtDate(sr.mve, nativeCurrency, baseCurrency, rateMaps, period.end);
      if (decomp !== null && mveBase !== null) {
        marketValueBase = mveBase.toString();
        costBase = decomp.fifo.costBase.toString();
        unrealizedBase = (toBaseAtDate(sr.unrealizedGain, nativeCurrency, baseCurrency, rateMaps, period.end) ?? new Decimal(0)).toString();
        realizedBase = (toBaseAtDate(sr.realizedGain, nativeCurrency, baseCurrency, rateMaps, period.end) ?? new Decimal(0)).toString();
        dividendsBase = (toBaseAtDate(sr.dividends, nativeCurrency, baseCurrency, rateMaps, period.end) ?? new Decimal(0)).toString();
        realizedCapitalBase   = decomp.realizedCapitalBase.toString();
        realizedFxBase        = decomp.realizedFxBase.toString();
        unrealizedCapitalBase = decomp.unrealizedCapitalBase.toString();
        unrealizedFxBase      = decomp.unrealizedFxBase.toString();
        dividendFxBase        = decomp.dividendFxBase.toString();

        // ─── Dual TTWROR / IRR (base pass) ────────────────────────────────
        const rawSecTxs = (data.txsBySecurity.get(sr.securityId) ?? []) as PerfTransaction[];
        const basePerf = computeSecurityPerfInBase(
          sr, nativeCurrency, baseCurrency, rawSecTxs, rateMaps, period,
        );
        if (basePerf !== null) {
          ttwrorBase = basePerf.ttwror.toString();
          ttwrorPaBase = basePerf.ttwrorPa.toString();
          irrBase = basePerf.irr?.toString() ?? null;
          irrBaseConverged = basePerf.irr !== null;
        }
      } else {
        // Rate unresolved — leave placeholders; security excluded from portfolio rollup (Task 5).
        marketValueBase = '0';
        costBase = '0';
        unrealizedBase = '0';
        realizedBase = '0';
        dividendsBase = '0';
      }
    }

    return {
      securityId: sr.securityId,
      currency: nativeCurrency,
      ttwror: sr.ttwror.toString(),
      ttwrorPa: sr.ttwrorPa.toString(),
      irr: sr.irr?.toString() ?? null,
      irrConverged: sr.irr !== null,
      mvb: sr.mvb.toString(),
      mve: sr.mve.toString(),
      purchaseValue: sr.purchaseValue.toString(),
      realizedGain: sr.realizedGain.toString(),
      unrealizedGain: sr.unrealizedGain.toString(),
      foreignCurrencyGains: sr.foreignCurrencyGains.toString(),
      fees: sr.fees.toString(),
      taxes: sr.taxes.toString(),
      dividends: sr.dividends.toString(),
      interest: sr.interest.toString(),
      shares: sr.sharesEnd.toString(),
      baseCurrency,
      marketValueBase,
      costBase,
      unrealizedBase,
      realizedBase,
      dividendsBase,
      realizedCapitalBase,
      realizedFxBase,
      unrealizedCapitalBase,
      unrealizedFxBase,
      dividendFxBase,
      ttwrorBase,
      ttwrorPaBase,
      irrBase,
      irrBaseConverged,
    };
  });
}

export type ChartInterval = 'daily' | 'weekly' | 'monthly';

export function resolveInterval(
  periodStart: string,
  periodEnd: string,
  requested: string,
): ChartInterval {
  if (requested === 'daily' || requested === 'weekly' || requested === 'monthly') {
    return requested;
  }
  const days = differenceInCalendarDays(parseISO(periodEnd), parseISO(periodStart));
  if (days <= 365) return 'daily';
  if (days <= 3 * 365) return 'weekly';
  return 'monthly';
}

export function getChartData(
  sqlite: BetterSqlite3.Database,
  period: { start: string; end: string },
  interval: ChartInterval,
  calendarId?: string,
  scope?: CalcScope,
): ChartPoint[] {
  const data = fetchBatchData(sqlite, period);

  const { baseCurrency, rateMaps } = buildFxContext(sqlite, data, period);

  const scopedTxs = scope ? data.allTxs.filter(scope.txFilter) : data.allTxs;
  const secResults = computeAllSecurities(sqlite, data, period, CostMethod.FIFO, true, scope?.securityIds, scope?.txFilter);

  // Scoped transaction list and deposit account IDs (mirrors getPortfolioCalc)
  const scopedDepositAccIds = scope ? scope.depositAccIds : data.depositAccIds;

  // Use scoped securities + accounts for both MV line and TTWROR,
  // keeping the chart MV line consistent with the TTWROR computation universe.
  // Pass fxContext so the daily MV series is in base ccy (mirrors getPortfolioCalc).
  const portfolioTotalDailyMV = buildPortfolioTotalDailyMV(
    secResults, scopedTxs, period, scopedDepositAccIds,
    { rateMaps, secCurrencyMap: data.secCurrencyMap, baseCurrency },
  );

  const periodDays = differenceInCalendarDays(parseISO(period.end), parseISO(period.start));

  // For security-only scopes (taxonomy, individual security), use security-level cashflows
  // (BUY/SELL/DIVIDEND/DELIVERY) instead of portfolio-level (DEPOSIT/REMOVAL/DELIVERY).
  // Without this, TTWROR treats BUY-day MV jumps as returns instead of cashflows.
  // Security-only path is left unchanged — per-security-native txs are already projected
  // by Phase 1's projectTransactionsToSecurityCurrency. Do not double-project.
  const isSecurityOnlyScope = scope && scope.depositAccIds.size === 0 && scope.securityIds.size > 0;
  let portfolioCashflows: Cashflow[];
  if (isSecurityOnlyScope) {
    portfolioCashflows = buildSecurityOnlyCashflows(scopedTxs, data.allTxs, scope, period);
  } else {
    // Project scoped txs to base ccy so cashflow amounts are unit-consistent
    // with the base-ccy MVB/MVE from the aggregation loop.
    // TODO(Task 9): surface unresolvedSecurityIds on the wire shape.
    const { projectedTxs: projectedScopedTxs } =
      projectTransactionsToBaseCurrency(scopedTxs, baseCurrency, rateMaps);
    portfolioCashflows = resolvePortfolioCashflows(projectedScopedTxs);
    if (scope && !scope.isTaxonomyScope) {
      appendTransferCashflows(portfolioCashflows, projectedScopedTxs, period);
    }
  }
  const snapshots = buildDailySnapshotsWithCarry(portfolioCashflows, portfolioTotalDailyMV, period);
  const ttwrorResult = computeTTWROR(snapshots, periodDays);

  const filledMV = carryForwardPrices(portfolioTotalDailyMV, period.start, period.end);
  const initialValue = filledMV.get(period.start) ?? new Decimal(0);

  // Accumulate transfers per day
  const transfersByDate = new Map<string, Decimal>();
  for (const cf of portfolioCashflows) {
    if (cf.date >= period.start && cf.date <= period.end) {
      transfersByDate.set(
        cf.date,
        (transfersByDate.get(cf.date) ?? new Decimal(0)).plus(cf.amount),
      );
    }
  }

  // Build O(1) lookup for daily returns
  const dailyReturnMap = new Map<string, { r: Decimal; cumR: Decimal }>();
  for (const dr of ttwrorResult.dailyReturns) {
    dailyReturnMap.set(dr.date, dr);
  }

  // Drawdown series: single-pass via computeMaxDrawdown (returns both stats + series)
  const mddResult = computeMaxDrawdown(
    ttwrorResult.dailyReturns.map((dr) => ({ date: dr.date, cumulativeReturn: dr.cumR })),
  );
  const drawdownMap = new Map<string, Decimal>();
  for (const dp of mddResult.drawdownSeries) {
    drawdownMap.set(dp.date, dp.drawdown);
  }

  // Build daily array for sampling
  const DECIMAL_ZERO = new Decimal(0);
  const days = eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) });
  const dailyData: ChartPoint[] = [];
  let cumulativeTransfers = DECIMAL_ZERO;

  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    const mv = filledMV.get(dateStr) ?? DECIMAL_ZERO;
    cumulativeTransfers = cumulativeTransfers.plus(transfersByDate.get(dateStr) ?? DECIMAL_ZERO);
    const dailyReturn = dailyReturnMap.get(dateStr);
    const cumR = dailyReturn?.cumR ?? DECIMAL_ZERO;
    const delta = initialValue.gt(0) ? mv.minus(initialValue).div(initialValue) : DECIMAL_ZERO;
    const dd = drawdownMap.get(dateStr) ?? DECIMAL_ZERO;

    dailyData.push({
      date: dateStr,
      marketValue: mv.toString(),
      transfersAccumulated: cumulativeTransfers.toString(),
      ttwrorCumulative: cumR.toString(),
      delta: delta.toString(),
      drawdown: dd.toString(),
    });
  }

  // Apply calendar filtering — filter non-trading days from chart output
  // TTWROR computation is unchanged (uses all calendar days for correctness)
  let chartData = dailyData;
  if (calendarId && calendarId !== 'empty') {
    chartData = dailyData.filter(p => isTradingDay(calendarId, p.date));
  }

  // Sample by interval
  if (interval === 'daily') return chartData;

  const sampled: ChartPoint[] = [];
  let lastMonth = -1;
  let lastWeek = -1;

  for (const point of chartData) {
    const d = parseISO(point.date);
    if (interval === 'monthly') {
      const m = d.getFullYear() * 12 + d.getMonth();
      if (m !== lastMonth) {
        sampled.push(point);
        lastMonth = m;
      }
    } else {
      // weekly: use ISO week number
      const weekNum = Math.floor(
        differenceInCalendarDays(d, parseISO(period.start)) / 7,
      );
      if (weekNum !== lastWeek) {
        sampled.push(point);
        lastWeek = weekNum;
      }
    }
  }

  // Always include the last point
  const lastPoint = chartData[chartData.length - 1];
  if (lastPoint && sampled[sampled.length - 1]?.date !== lastPoint.date) {
    sampled.push(lastPoint);
  }

  return sampled;
}

// ─── Per-security TTWROR time series ─────────────────────────────────────────

export interface SecurityTtwrorSeriesResult {
  securityId: string;
  securityName: string;
  series: Array<{ date: string; cumulativeReturn: string }>;
}

export function getSecurityTtwrorSeries(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  period: { start: string; end: string },
  interval: ChartInterval,
  calendarId: string,
  costMethod: CostMethod = CostMethod.MOVING_AVERAGE,
  preTax = true,
): SecurityTtwrorSeriesResult | null {
  const data = fetchBatchData(sqlite, period);

  // Check security exists in our transaction data
  if (!data.txsBySecurity.has(securityId)) {
    // Security has no transactions — check if it exists in DB at all
    const secRow = sqlite.prepare(
      `SELECT name FROM security WHERE uuid = ?`
    ).get(securityId) as { name: string } | undefined;
    if (!secRow) return null; // security doesn't exist

    return {
      securityId,
      securityName: secRow.name,
      series: buildFlatZeroSeries(period, interval, calendarId),
    };
  }

  const filter = new Set([securityId]);
  const results = computeAllSecurities(sqlite, data, period, costMethod, preTax, filter);
  if (results.length === 0) return null;

  const sr = results[0];
  const secInfo = data.securityInfoMap.get(securityId);
  const securityName = secInfo?.name ?? 'Unknown';

  // Build daily series from dailyReturns
  const dailySeries = sr.dailyReturns.map((dr) => ({
    date: dr.date,
    cumulativeReturn: dr.cumR.toNumber(),
  }));

  // Apply calendar filtering (same as portfolio chart)
  let filtered = dailySeries;
  if (calendarId && calendarId !== 'empty') {
    filtered = dailySeries.filter((p) => isTradingDay(calendarId, p.date));
  }

  // Apply sampling
  const sampled = sampleNumericSeries(filtered, interval, period.start);

  return {
    securityId,
    securityName,
    series: sampled.map((p) => ({
      date: p.date,
      cumulativeReturn: p.cumulativeReturn.toString(),
    })),
  };
}

/** Build a flat 0% series for a security with no transactions. */
function buildFlatZeroSeries(
  period: { start: string; end: string },
  interval: ChartInterval,
  calendarId: string,
): Array<{ date: string; cumulativeReturn: string }> {
  const days = eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) });
  let series = days.map((d) => ({
    date: format(d, 'yyyy-MM-dd'),
    cumulativeReturn: 0,
  }));

  if (calendarId && calendarId !== 'empty') {
    series = series.filter((p) => isTradingDay(calendarId, p.date));
  }

  const sampled = sampleNumericSeries(series, interval, period.start);
  return sampled.map((p) => ({ date: p.date, cumulativeReturn: '0' }));
}

/** Generic numeric series sampler matching the portfolio chart sampling. */
function sampleNumericSeries<T extends { date: string }>(
  series: T[],
  interval: ChartInterval,
  periodStart: string,
): T[] {
  if (interval === 'daily') return series;

  const sampled: T[] = [];
  let lastMonth = -1;
  let lastWeek = -1;

  for (const point of series) {
    const d = parseISO(point.date);
    if (interval === 'monthly') {
      const m = d.getFullYear() * 12 + d.getMonth(); // native-ok
      if (m !== lastMonth) {
        sampled.push(point);
        lastMonth = m;
      }
    } else {
      const weekNum = Math.floor(
        differenceInCalendarDays(d, parseISO(periodStart)) / 7,
      ); // native-ok
      if (weekNum !== lastWeek) {
        sampled.push(point);
        lastWeek = weekNum;
      }
    }
  }

  const lastPoint = series[series.length - 1]; // native-ok
  if (lastPoint && sampled[sampled.length - 1]?.date !== lastPoint.date) { // native-ok
    sampled.push(lastPoint);
  }

  return sampled;
}

// ─── Statement of assets (used by reports) ───────────────────────────────────

export interface StatementSecurityEntry {
  securityId: string;
  name: string;
  shares: string;
  pricePerShare: string;
  marketValue: string;
  currency: string;
}

export interface StatementAccountEntry {
  accountId: string;
  name: string;
  balance: string;
  currency: string;
}

export interface StatementOfAssetsResult {
  date: string;
  securities: StatementSecurityEntry[];
  depositAccounts: StatementAccountEntry[];
  totals: {
    marketValue: string;
    securityValue: string;
    cashValue: string;
    cashByCurrency: Array<{ currency: string; value: string }>;
    unresolvedCount: number;
    unresolvedSecurityIds: string[];
  };
}

export function getStatementOfAssets(
  sqlite: BetterSqlite3.Database,
  date: string,
): StatementOfAssetsResult {
  const baseCurrency = getPortfolioBaseCurrency(sqlite);

  // Securities: get price and compute shares held at date
  const securities = sqlite
    .prepare(
      `SELECT uuid, name, currency FROM security`,
    )
    .all() as { uuid: string; name: string; currency: string }[];

  const pricesAtDate = fetchPriceAtDate(sqlite, date);

  // Build RateMaps for foreign currencies
  const foreignCurrencies = new Set<string>();
  const allAccounts = sqlite.prepare(
    `SELECT uuid, name, currency FROM account WHERE type = 'account'`
  ).all() as { uuid: string; name: string; currency: string | null }[];
  for (const s of securities) {
    if (s.currency && s.currency !== baseCurrency) foreignCurrencies.add(s.currency);
  }
  for (const a of allAccounts) {
    if (a.currency && a.currency !== baseCurrency) foreignCurrencies.add(a.currency);
  }
  const soaRateMaps = new Map<string, RateMap>();
  for (const cur of foreignCurrencies) {
    soaRateMaps.set(cur, buildRateMap(sqlite, cur, baseCurrency, date, date));
  }

  // Inject latest_price when: (a) no historical close exists for that date, OR
  // (b) it IS the statement date — latest_price is the most current available
  // price and must win over a same-day historical snapshot for live MV display.
  const latestPricesAll = fetchLatestPrices(sqlite);

  // Collect candidate dates from latest_price to batch the existence check.
  const candidateDates = [...new Set(
    [...latestPricesAll.values()]
      .map(l => l.date)
      .filter((d): d is string => d !== null && d <= date),
  )];

  // One query to find all (security, tstamp) pairs that already have a historical close.
  const existingPrices = new Set<string>();
  if (candidateDates.length > 0) {
    const placeholders = candidateDates.map(() => '?').join(',');
    const rows = sqlite
      .prepare(
        `SELECT security, tstamp FROM price WHERE tstamp IN (${placeholders})`,
      )
      .all(candidateDates) as { security: string; tstamp: string }[];
    for (const r of rows) existingPrices.add(`${r.security}|${r.tstamp}`);
  }

  for (const [secId, latest] of latestPricesAll) {
    if (latest.price.gt(0) && latest.date !== null && latest.date <= date) {
      if (!existingPrices.has(`${secId}|${latest.date}`) || latest.date === date) {
        pricesAtDate.set(secId, latest.price);
      }
    }
  }

  // Aggregate net shares per security up to date via SQL (divisione 1e8 in JS con Decimal)
  const netSharesMap = fetchNetSharesPerSecurity(sqlite, date);

  const secEntries: StatementSecurityEntry[] = [];
  let totalSecValue = new Decimal(0);
  const unresolvedSecurityIds: string[] = [];

  for (const sec of securities) {
    const sh = netSharesMap.get(sec.uuid) ?? new Decimal(0);
    if (sh.lte(0)) continue;
    const price = pricesAtDate.get(sec.uuid) ?? new Decimal(0);
    const mv = sh.times(price);
    const secCurrency = sec.currency ?? baseCurrency;
    let convertedMV = mv;
    let displayCurrency = secCurrency;
    if (secCurrency !== baseCurrency) {
      const rateMap = soaRateMaps.get(secCurrency);
      const rate = rateMap ? getRateFromMap(rateMap, date) : null;
      if (rate) {
        convertedMV = convertToBase(mv, rate);
        displayCurrency = baseCurrency;
      } else {
        // FX unresolvable — emit the row in native currency for visibility
        // but exclude from the base-currency total.
        unresolvedSecurityIds.push(sec.uuid);
        secEntries.push({
          securityId: sec.uuid,
          name: sec.name,
          shares: sh.toString(),
          pricePerShare: price.toString(),
          marketValue: mv.toString(),
          currency: secCurrency,
        });
        continue;
      }
    }
    totalSecValue = totalSecValue.plus(convertedMV);
    secEntries.push({
      securityId: sec.uuid,
      name: sec.name,
      shares: sh.toString(),
      pricePerShare: price.toString(),
      marketValue: convertedMV.toString(),
      currency: displayCurrency,
    });
  }

  // Deposit accounts: compute all balances in one batch query
  const accounts = allAccounts as { uuid: string; name: string; currency: string }[];
  const allDepositBalances = fetchAllDepositBalances(sqlite, date);

  const acctEntries: StatementAccountEntry[] = [];
  let totalCashValue = new Decimal(0);
  const nativeCashByCurrency = new Map<string, Decimal>();

  for (const acct of accounts) {
    const balance = allDepositBalances.get(acct.uuid) ?? new Decimal(0);

    if (balance.isZero()) continue;
    const acctCurrency = acct.currency ?? baseCurrency;
    nativeCashByCurrency.set(
      acctCurrency,
      (nativeCashByCurrency.get(acctCurrency) ?? new Decimal(0)).plus(balance),
    );
    let convertedBalance = balance;
    let displayAcctCurrency = acctCurrency;
    if (acctCurrency !== baseCurrency) {
      const rateMap = soaRateMaps.get(acctCurrency);
      const rate = rateMap ? getRateFromMap(rateMap, date) : null;
      if (rate) {
        convertedBalance = convertToBase(balance, rate);
        displayAcctCurrency = baseCurrency;
      }
    }
    totalCashValue = totalCashValue.plus(convertedBalance);
    acctEntries.push({
      accountId: acct.uuid,
      name: acct.name,
      balance: convertedBalance.toString(),
      currency: displayAcctCurrency,
    });
  }

  const totalMV = totalSecValue.plus(totalCashValue);

  const cashByCurrencyArr: Array<{ currency: string; value: string }> = [];
  const sortedCurrencies = [...nativeCashByCurrency.keys()].sort((a, b) => {
    if (a === baseCurrency) return -1;
    if (b === baseCurrency) return 1;
    return a.localeCompare(b);
  });
  for (const cur of sortedCurrencies) {
    cashByCurrencyArr.push({ currency: cur, value: nativeCashByCurrency.get(cur)!.toString() });
  }

  return {
    date,
    securities: secEntries,
    depositAccounts: acctEntries,
    totals: {
      marketValue: totalMV.toString(),
      securityValue: totalSecValue.toString(),
      cashValue: totalCashValue.toString(),
      cashByCurrency: cashByCurrencyArr,
      unresolvedCount: unresolvedSecurityIds.length,
      unresolvedSecurityIds,
    },
  };
}

// ─── Returns Heatmap ──────────────────────────────────────────────────────────

export interface ReturnsHeatmapEntry {
  monthly: Array<{ year: number; month: number; value: string }>;
  yearly: Array<{ year: number; value: string }>;
}

export function getReturnsHeatmap(sqlite: BetterSqlite3.Database, scope?: CalcScope, periodParam?: { start: string; end: string }): ReturnsHeatmapEntry {
  // Find earliest transaction date to cover the full history
  const row = sqlite
    .prepare(`SELECT MIN(date) as minDate FROM xact`)
    .get() as { minDate: string | null };

  const today = format(new Date(), 'yyyy-MM-dd');
  const minDate = (row?.minDate ?? today).slice(0, 10);

  const period = periodParam ?? { start: minDate, end: today };

  const data = fetchBatchData(sqlite, period);

  const { baseCurrency, rateMaps } = buildFxContext(sqlite, data, period);

  const scopedTxs = scope ? data.allTxs.filter(scope.txFilter) : data.allTxs;
  const secResults = computeAllSecurities(sqlite, data, period, CostMethod.FIFO, true, scope?.securityIds, scope?.txFilter);

  const scopedDepositAccIds = scope ? scope.depositAccIds : data.depositAccIds;

  const portfolioTotalDailyMV = buildPortfolioTotalDailyMV(
    secResults, scopedTxs, period, scopedDepositAccIds,
    { rateMaps, secCurrencyMap: data.secCurrencyMap, baseCurrency },
  );

  const periodDays = differenceInCalendarDays(parseISO(period.end), parseISO(period.start));
  // For security-only scopes (taxonomy, individual security), use security-level cashflows
  // (BUY/SELL/DIVIDEND/DELIVERY) instead of portfolio-level (DEPOSIT/REMOVAL/DELIVERY).
  // Without this, TTWROR treats BUY-day MV jumps as returns instead of cashflows.
  // Security-only path is left unchanged — per-security-native txs are already projected
  // by Phase 1's projectTransactionsToSecurityCurrency. Do not double-project.
  const isSecurityOnlyScope = scope && scope.depositAccIds.size === 0 && scope.securityIds.size > 0;
  let portfolioCashflows: Cashflow[];
  if (isSecurityOnlyScope) {
    portfolioCashflows = buildSecurityOnlyCashflows(scopedTxs, data.allTxs, scope, period);
  } else {
    // Project scoped txs to base ccy so cashflow amounts are unit-consistent
    // with the base-ccy MVB/MVE from the aggregation loop.
    // TODO(Task 9): surface unresolvedSecurityIds on the wire shape.
    const { projectedTxs: projectedScopedTxs } =
      projectTransactionsToBaseCurrency(scopedTxs, baseCurrency, rateMaps);
    portfolioCashflows = resolvePortfolioCashflows(projectedScopedTxs);
    if (scope && !scope.isTaxonomyScope) {
      appendTransferCashflows(portfolioCashflows, projectedScopedTxs, period);
    }
  }
  const snapshots = buildDailySnapshotsWithCarry(portfolioCashflows, portfolioTotalDailyMV, period);
  // Prepend a dummy "day before inception" snapshot (MVE=0) so computeTTWROR captures
  // the inception factor at i=1: factor = MVE_day0 / (0 + CFin_day0).
  // Without this, the first day's return is lost because the loop starts at i=1.
  if (snapshots.length > 0) {
    snapshots.unshift({
      date: format(subDays(parseISO(snapshots[0].date), 1), 'yyyy-MM-dd'),
      mve: new Decimal(0),
      cfIn: new Decimal(0),
      cfOut: new Decimal(0),
    });
  }
  const ttwrorResult = computeTTWROR(snapshots, periodDays);

  const result = aggregateMonthlyReturns(ttwrorResult.dailyReturns);

  return {
    monthly: result.monthly.map((m) => ({ year: m.year, month: m.month, value: m.value.toString() })),
    yearly: result.yearly.map((y) => ({ year: y.year, value: y.value.toString() })),
  };
}

