import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import { CostMethod, isTradingDay, TransactionType } from '@quovibe/shared';
import {
  resolveSecurityCashflows,
  buildDailySnapshotsWithCarry,
  carryForwardPrices,
  computeTTWROR,
  computeIRR,
  getGrossAmount,
  getFees,
  getTaxes,
} from '@quovibe/engine';
import {
  differenceInCalendarDays,
  parseISO,
  format,
  eachDayOfInterval,
} from 'date-fns';
import {
  fetchBatchData,
  computeAllSecurities,
  resolveInterval,
  buildDailyCashMap,
  type ChartInterval,
  type SecurityPerfInternal,
  type BatchData,
} from './performance.service';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface TaxonomySliceChartPoint {
  date: string;
  marketValue: string;
  ttwrorCumulative: string;
}

export interface TaxonomySliceResult {
  categoryId: string;
  categoryName: string;
  color: string | null;
  ttwror: string;
  ttwrorPa: string;
  irr: string | null;
  mvb: string;
  mve: string;
  absoluteGain: string;
  fees: string;
  taxes: string;
  dividends: string;
  interest: string;
  chartData: TaxonomySliceChartPoint[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Resolves all descendant category UUIDs (inclusive of the root) via DFS. */
function resolveDescendantCategories(
  sqlite: BetterSqlite3.Database,
  categoryId: string,
): string[] {
  const cat = sqlite
    .prepare(`SELECT taxonomy FROM taxonomy_category WHERE uuid = ?`)
    .get(categoryId) as { taxonomy: string } | undefined;
  if (!cat) return [categoryId];

  const rows = sqlite
    .prepare(`SELECT uuid, parent FROM taxonomy_category WHERE taxonomy = ?`)
    .all(cat.taxonomy) as { uuid: string; parent: string | null }[];

  const childrenMap = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parent) {
      if (!childrenMap.has(row.parent)) childrenMap.set(row.parent, []);
      childrenMap.get(row.parent)!.push(row.uuid);
    }
  }

  const result: string[] = [];
  function dfs(id: string) {
    result.push(id);
    for (const child of childrenMap.get(id) ?? []) dfs(child);
  }
  dfs(categoryId);
  return result;
}

/**
 * Returns maps of securityId → weight and accountId → weight for a category
 * and all its descendants. Handles both item_type = 'security' and 'account'
 * (the latter is used for deposit/cash accounts like "Contanti").
 */
function resolveSliceItems(
  sqlite: BetterSqlite3.Database,
  categoryId: string,
): { securityWeights: Map<string, Decimal>; accountWeights: Map<string, Decimal> } {
  const categoryIds = resolveDescendantCategories(sqlite, categoryId);
  const placeholders = categoryIds.map(() => '?').join(',');

  const assignments = sqlite
    .prepare(
      `SELECT item, item_type, weight FROM taxonomy_assignment
       WHERE category IN (${placeholders})`,
    )
    .all(...categoryIds) as { item: string; item_type: string | null; weight: number | null }[];

  const securityWeights = new Map<string, Decimal>();
  const accountWeights = new Map<string, Decimal>();
  for (const a of assignments) {
    // NULL weight means 100% (10000 in DB scale)
    const w = new Decimal(a.weight ?? 10000).div(10000);
    if (w.lte(0)) continue;
    const target = a.item_type === 'account' ? accountWeights : securityWeights;
    target.set(a.item, (target.get(a.item) ?? new Decimal(0)).plus(w));
  }
  return { securityWeights, accountWeights };
}

function getCategoryMeta(
  sqlite: BetterSqlite3.Database,
  categoryId: string,
): { name: string; color: string | null } {
  const row = sqlite
    .prepare(`SELECT name, color FROM taxonomy_category WHERE uuid = ?`)
    .get(categoryId) as { name: string; color: string | null } | undefined;
  return row ?? { name: categoryId, color: null };
}

function sampleChartPoints(
  points: TaxonomySliceChartPoint[],
  periodStart: string,
  interval: ChartInterval,
): TaxonomySliceChartPoint[] {
  if (interval === 'daily' || points.length === 0) return points;

  const sampled: TaxonomySliceChartPoint[] = [];
  let lastMonth = -1;
  let lastWeek = -1;

  for (const point of points) {
    const d = parseISO(point.date);
    if (interval === 'monthly') {
      const m = d.getFullYear() * 12 + d.getMonth();
      if (m !== lastMonth) { sampled.push(point); lastMonth = m; }
    } else {
      const weekNum = Math.floor(
        differenceInCalendarDays(d, parseISO(periodStart)) / 7,
      );
      if (weekNum !== lastWeek) { sampled.push(point); lastWeek = weekNum; }
    }
  }

  // Always include the last point
  const lastPoint = points[points.length - 1];
  if (lastPoint && sampled[sampled.length - 1]?.date !== lastPoint.date) {
    sampled.push(lastPoint);
  }

  return sampled;
}

function computeSlicePerformance(
  categoryId: string,
  categoryName: string,
  color: string | null,
  securityWeights: Map<string, Decimal>,
  accountWeights: Map<string, Decimal>,
  allSecPerf: SecurityPerfInternal[],
  batchData: BatchData,
  period: { start: string; end: string },
  preTax: boolean,
  interval: ChartInterval,
  calendarId?: string,
): TaxonomySliceResult {
  const periodDays = differenceInCalendarDays(parseISO(period.end), parseISO(period.start));

  const aggregatedDailyMV = new Map<string, Decimal>();
  let aggMvb = new Decimal(0);
  let aggMve = new Decimal(0);
  let aggFees = new Decimal(0);
  let aggTaxes = new Decimal(0);
  let aggDividends = new Decimal(0);
  let aggInterest = new Decimal(0);
  let aggRealizedGain = new Decimal(0);
  let aggUnrealizedGain = new Decimal(0);
  const aggregatedCashflows: ReturnType<typeof resolveSecurityCashflows> = [];

  for (const sr of allSecPerf) {
    const weight = securityWeights.get(sr.securityId);
    if (!weight || weight.lte(0)) continue;

    // Scale carry-forward daily MVs
    const filledMV = carryForwardPrices(sr.dailyMV, period.start, period.end);
    for (const [date, mv] of filledMV) {
      aggregatedDailyMV.set(
        date,
        (aggregatedDailyMV.get(date) ?? new Decimal(0)).plus(mv.times(weight)),
      );
    }

    // Scale scalar metrics
    aggMvb = aggMvb.plus(sr.mvb.times(weight));
    aggMve = aggMve.plus(sr.mve.times(weight));
    aggFees = aggFees.plus(sr.fees.times(weight));
    aggTaxes = aggTaxes.plus(sr.taxes.times(weight));
    aggDividends = aggDividends.plus(sr.dividends.times(weight));
    aggInterest = aggInterest.plus(sr.interest.times(weight));
    aggRealizedGain = aggRealizedGain.plus(sr.realizedGain.times(weight));
    aggUnrealizedGain = aggUnrealizedGain.plus(sr.unrealizedGain.times(weight));

    // Resolve and scale cashflows (only in-period). Exclude DIVIDEND — handled by §3.5 below.
    const secTxs = batchData.txsBySecurity.get(sr.securityId) ?? [];
    const cfs = resolveSecurityCashflows(secTxs, sr.securityId, !preTax)
      .filter(cf => cf.type !== TransactionType.DIVIDEND);
    for (const cf of cfs) {
      if (cf.date >= period.start && cf.date <= period.end) {
        aggregatedCashflows.push({ ...cf, amount: cf.amount.times(weight) });
      }
    }
  }

  // PP §3.5: transactions on non-classified accounts for classified securities.
  // FEES → DEPOSIT (transferal). FEES_REFUND → REMOVAL.
  // DIVIDENDS → offsetting REMOVAL (gross - fees, or gross - fees - taxes for post-tax).
  for (const [securityId, weight] of securityWeights) {
    const secTxs = batchData.txsBySecurity.get(securityId) ?? [];
    for (const tx of secTxs) {
      if (tx.date < period.start || tx.date > period.end) continue;
      const ptx = tx as import('./performance.service').PerfTransaction;
      const isNonClassifiedAccount = !accountWeights.has(ptx.accountId);
      if (!isNonClassifiedAccount) continue;
      const amount = new Decimal(tx.amount ?? 0).times(weight);
      if (amount.isZero()) continue;
      switch (tx.type) {
        case TransactionType.FEES:
          aggregatedCashflows.push({ date: tx.date, amount, type: TransactionType.DEPOSIT });
          break;
        case TransactionType.FEES_REFUND:
          aggregatedCashflows.push({ date: tx.date, amount: amount.negated(), type: TransactionType.REMOVAL });
          break;
        case TransactionType.DIVIDEND:
          // §3.5: offsetting REMOVAL for dividend cash leaving the classification.
          // Must match resolveSecurityCashflows logic: gross - fees (pre-tax) or gross - fees - taxes (post-tax).
          // Using tx.amount (net = gross - fees - taxes) would under-compensate in pre-tax mode,
          // causing dividend taxes to incorrectly reduce TTWROR.
          if (tx.shares != null && tx.shares > 0) {
            const divGross = getGrossAmount(tx);
            const divFees = getFees(tx);
            const divTaxes = preTax ? new Decimal(0) : getTaxes(tx);
            const divCfOut = divGross.minus(divFees).minus(divTaxes).times(weight);
            aggregatedCashflows.push({ date: tx.date, amount: divCfOut.negated(), type: TransactionType.REMOVAL });
          }
          break;
      }
    }
  }

  // ── Deposit accounts (cash) ──
  for (const [accId, weight] of accountWeights) {
    const accTxs = batchData.allTxs.filter(tx => tx.accountId === accId);
    if (accTxs.length === 0) continue;

    const dailyCash = buildDailyCashMap(accTxs, period, new Set([accId]));

    for (const [date, cash] of dailyCash) {
      aggregatedDailyMV.set(
        date,
        (aggregatedDailyMV.get(date) ?? new Decimal(0)).plus(cash.times(weight)),
      );
    }

    const cashAtStart = dailyCash.get(period.start) ?? new Decimal(0);
    const cashAtEnd = dailyCash.get(period.end) ?? new Decimal(0);
    aggMvb = aggMvb.plus(cashAtStart.times(weight));
    aggMve = aggMve.plus(cashAtEnd.times(weight));

    // Cashflows for combined-slice TTWROR (PP §3.4 rules):
    // Only DEPOSIT/REMOVAL/DELIVERY and boundary-crossing flows are transferals.
    // FEES/INTEREST_CHARGE are costs (NOT transferals). INTEREST taxes → REMOVAL.
    for (const tx of accTxs) {
      if (tx.date < period.start || tx.date > period.end) continue;
      const gross = new Decimal(tx.amount ?? 0).times(weight);
      switch (tx.type) {
        case TransactionType.DEPOSIT:
        case TransactionType.SELL:
        case TransactionType.TAX_REFUND:
          aggregatedCashflows.push({ date: tx.date, amount: gross, type: tx.type });
          break;
        case TransactionType.REMOVAL:
        case TransactionType.BUY:
        case TransactionType.TAXES:
          aggregatedCashflows.push({ date: tx.date, amount: gross.negated(), type: tx.type });
          break;
        case TransactionType.FEES:
          // PP §3.4: non-categorized security → REMOVAL (transferal). Otherwise cost.
          if (tx.securityId && !securityWeights.has(tx.securityId)) {
            aggregatedCashflows.push({ date: tx.date, amount: gross.negated(), type: tx.type });
          }
          break;
        case TransactionType.FEES_REFUND:
          if (tx.securityId && !securityWeights.has(tx.securityId)) {
            aggregatedCashflows.push({ date: tx.date, amount: gross, type: tx.type });
          }
          break;
        // INTEREST_CHARGE: cost (NOT transferal). Only taxes → REMOVAL.
        case TransactionType.INTEREST: {
          // PP §3.4: grosses up INTEREST by taxes → REMOVAL for the tax amount.
          const interestTax = getTaxes(tx);
          if (!interestTax.isZero()) {
            aggregatedCashflows.push({ date: tx.date, amount: interestTax.negated().times(weight), type: TransactionType.TAXES });
          }
          break;
        }
        case TransactionType.INTEREST_CHARGE: {
          // PP §3.4: same gross-up pattern. Taxes → REMOVAL.
          const ichargeTax = getTaxes(tx);
          if (!ichargeTax.isZero()) {
            aggregatedCashflows.push({ date: tx.date, amount: ichargeTax.negated().times(weight), type: TransactionType.TAXES });
          }
          break;
        }
        case TransactionType.DIVIDEND:
          // Dividends from securities NOT in this slice are external inflows
          // (attributed to the security's category, not this one). Neutralise them.
          // Dividends from slice securities are already handled at the security level.
          if (tx.securityId && !securityWeights.has(tx.securityId)) {
            aggregatedCashflows.push({ date: tx.date, amount: gross, type: tx.type });
          }
          break;
        case TransactionType.TRANSFER_BETWEEN_ACCOUNTS: {
          // Cash transfers between accounts: neutralise so they don't affect TTWROR.
          const ptx = tx as import('./performance.service').PerfTransaction;
          const transferAmount = ptx.isTransferOut ? gross.negated() : gross;
          aggregatedCashflows.push({ date: tx.date, amount: transferAmount, type: tx.type });
          break;
        }
      }
    }
  }

  // Compute TTWROR on aggregated slice
  const snapshots = buildDailySnapshotsWithCarry(aggregatedCashflows, aggregatedDailyMV, period);
  const ttwrorResult = computeTTWROR(snapshots, periodDays);

  // Compute IRR on aggregated slice — exclude start-day cashflows because MVB
  // already includes their effect (end-of-day balance). Including them would double-count.
  const irrCashflows = aggregatedCashflows.filter(cf => cf.date > period.start);
  const irrResult = computeIRR({
    mvb: aggMvb,
    mve: aggMve,
    cashflows: irrCashflows,
    periodStart: period.start,
    periodEnd: period.end,
  });

  // Build chart data
  const filledMV = carryForwardPrices(aggregatedDailyMV, period.start, period.end);
  const dailyReturnMap = new Map<string, Decimal>();
  for (const dr of ttwrorResult.dailyReturns) {
    dailyReturnMap.set(dr.date, dr.cumR);
  }

  const allChartPoints: TaxonomySliceChartPoint[] = eachDayOfInterval({
    start: parseISO(period.start),
    end: parseISO(period.end),
  }).map((day) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return {
      date: dateStr,
      marketValue: (filledMV.get(dateStr) ?? new Decimal(0)).toString(),
      ttwrorCumulative: (dailyReturnMap.get(dateStr) ?? new Decimal(0)).toString(),
    };
  });

  // Filter to trading days only
  let filteredPoints = allChartPoints;
  if (calendarId && calendarId !== 'empty') {
    filteredPoints = allChartPoints.filter(p => isTradingDay(calendarId, p.date));
  }

  const chartData = sampleChartPoints(filteredPoints, period.start, interval);
  const absoluteGain = aggRealizedGain.plus(aggUnrealizedGain);

  return {
    categoryId,
    categoryName,
    color,
    ttwror: ttwrorResult.cumulative.toString(),
    ttwrorPa: ttwrorResult.annualized.toString(),
    irr: irrResult?.toString() ?? null,
    mvb: aggMvb.toString(),
    mve: aggMve.toString(),
    absoluteGain: absoluteGain.toString(),
    fees: aggFees.toString(),
    taxes: aggTaxes.toString(),
    dividends: aggDividends.toString(),
    interest: aggInterest.toString(),
    chartData,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getTaxonomySeriesPerformance(
  sqlite: BetterSqlite3.Database,
  taxonomyId: string,
  categoryIds: string[],
  period: { start: string; end: string },
  costMethod: CostMethod,
  preTax: boolean,
  requestedInterval = 'auto',
  calendarId?: string,
): TaxonomySliceResult[] {
  const interval = resolveInterval(period.start, period.end, requestedInterval);
  const batchData = fetchBatchData(sqlite, period);
  const allSecPerf = computeAllSecurities(batchData, period, costMethod, preTax);

  return categoryIds.map((categoryId) => {
    const meta = getCategoryMeta(sqlite, categoryId);
    const { securityWeights, accountWeights } = resolveSliceItems(sqlite, categoryId);
    return computeSlicePerformance(
      categoryId,
      meta.name,
      meta.color,
      securityWeights,
      accountWeights,
      allSecPerf,
      batchData,
      period,
      preTax,
      interval,
      calendarId,
    );
  });
}
