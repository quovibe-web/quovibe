import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import { differenceInCalendarDays, parseISO, format, eachDayOfInterval } from 'date-fns';
import type { BenchmarkSeriesItem } from '@quovibe/shared';
import { isTradingDay } from '@quovibe/shared';
import {
  computeBenchmarkSeries,
  getRateFromMap,
  resolvePortfolioCashflows,
  buildDailySnapshotsWithCarry,
  carryForwardPrices,
  computeTTWROR,
} from '@quovibe/engine';
import type { ChartInterval } from './performance.service';
import { fetchAllTransactions, fetchPricesForPeriod } from './performance.service';
import { buildRateMap } from './fx.service';
import { safeDecimal } from './unit-conversion';

// ─── DB row types ─────────────────────────────────────────────────────────────

interface SecurityRow {
  uuid: string;
  name: string | null;
  isin: string | null;
  tickerSymbol: string | null;
  currency: string | null;
}

interface PriceRow {
  tstamp: string;
  value: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBaseCurrency(sqlite: BetterSqlite3.Database): string {
  const row = sqlite.prepare(
    `SELECT value FROM property WHERE name = 'portfolio.currency'`
  ).get() as { value: string } | undefined;
  if (row?.value) return row.value;

  const acct = sqlite.prepare(
    `SELECT currency FROM account WHERE type = 'account' AND currency IS NOT NULL LIMIT 1`
  ).get() as { currency: string } | undefined;
  return acct?.currency ?? 'EUR';
}

function resolveSecurityName(row: SecurityRow): string {
  if (row.name) return row.name;
  if (row.isin) return row.isin;
  if (row.tickerSymbol) return row.tickerSymbol;
  return 'Unknown';
}

/**
 * Applies the same weekly/monthly sampling logic as getChartData.
 * Daily interval returns the data as-is.
 */
function sampleSeries(
  series: Array<{ date: string; cumulative: number }>,
  interval: ChartInterval,
  periodStart: string,
  calendarId?: string,
): Array<{ date: string; cumulative: number }> {
  // Apply calendar filtering (same as portfolio chart) so sampled dates align
  const filtered = calendarId && calendarId !== 'empty'
    ? series.filter(p => isTradingDay(calendarId, p.date))
    : series;

  if (interval === 'daily') return filtered;

  const sampled: Array<{ date: string; cumulative: number }> = [];
  let lastMonth = -1;
  let lastWeek = -1;

  for (const point of filtered) {
    const d = parseISO(point.date);
    if (interval === 'monthly') {
      const m = d.getFullYear() * 12 + d.getMonth(); // native-ok
      if (m !== lastMonth) {
        sampled.push(point);
        lastMonth = m;
      }
    } else {
      // weekly: 7-day buckets from periodStart
      const weekNum = Math.floor(
        differenceInCalendarDays(d, parseISO(periodStart)) / 7,
      ); // native-ok
      if (weekNum !== lastWeek) {
        sampled.push(point);
        lastWeek = weekNum;
      }
    }
  }

  // Always include the last point
  const lastPoint = filtered[filtered.length - 1]; // native-ok
  if (lastPoint && sampled[sampled.length - 1]?.date !== lastPoint.date) { // native-ok
    sampled.push(lastPoint);
  }

  return sampled;
}

// ─── Portfolio cumulative series (Daimler optimization) ───────────────────────

/**
 * Computes the portfolio TTWROR cumulative series for the given period.
 * Only called when a security has no price on/before the period start date
 * (the "Daimler edge case" in computeBenchmarkSeries).
 *
 * Builds a daily total market value from all securities, then runs TTWROR.
 */
function fetchPortfolioCumulativeSeries(
  sqlite: BetterSqlite3.Database,
  period: { start: string; end: string },
): Array<{ date: string; ttwrorCumulative: Decimal }> {
  const allTxs = fetchAllTransactions(sqlite);
  const pricesBySecAndDate = fetchPricesForPeriod(sqlite, period.start, period.end);

  // Build daily total market value across all securities
  const days = eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) });

  // Aggregate all security price maps into a single portfolio MV map
  // We use carryForwardPrices per security and sum, then combine
  const allSecMVByDate = new Map<string, Decimal>();

  for (const [, priceMap] of pricesBySecAndDate) {
    const filled = carryForwardPrices(priceMap, period.start, period.end);
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd');
      const price = filled.get(dateStr);
      if (price) {
        allSecMVByDate.set(
          dateStr,
          (allSecMVByDate.get(dateStr) ?? new Decimal(0)).plus(price),
        );
      }
    }
  }

  const periodDays = differenceInCalendarDays(parseISO(period.end), parseISO(period.start)); // native-ok
  const portfolioCashflows = resolvePortfolioCashflows(allTxs);
  const snapshots = buildDailySnapshotsWithCarry(portfolioCashflows, allSecMVByDate, period);
  const ttwrorResult = computeTTWROR(snapshots, periodDays);

  return ttwrorResult.dailyReturns.map((dr) => ({
    date: dr.date,
    ttwrorCumulative: dr.cumR,
  }));
}

// ─── Main service function ────────────────────────────────────────────────────

/**
 * Computes benchmark series for a list of security UUIDs over the given period.
 * Unknown UUIDs produce an empty series (not a 404).
 * FX conversion to base currency is applied when the security currency differs.
 */
export function getBenchmarkSeries(
  sqlite: BetterSqlite3.Database,
  securityIds: string[],
  period: { start: string; end: string },
  interval: ChartInterval,
  calendarId?: string,
): BenchmarkSeriesItem[] {
  const baseCurrency = getBaseCurrency(sqlite);

  // 90-day lookback before period start for forward-fill seeding
  const lookbackDate = new Date(parseISO(period.start).getTime() - 90 * 24 * 60 * 60 * 1000); // native-ok
  const lookbackStart = format(lookbackDate, 'yyyy-MM-dd');

  // Lazy portfolio cumulative series (only fetched once, if needed for Daimler edge case)
  let portfolioCumulativeSeries: Array<{ date: string; ttwrorCumulative: Decimal }> | undefined;

  const results: BenchmarkSeriesItem[] = [];

  for (const securityId of securityIds) {
    // Resolve security metadata
    const secRow = sqlite.prepare(
      `SELECT uuid, name, isin, tickerSymbol, currency FROM security WHERE uuid = ?`
    ).get(securityId) as SecurityRow | undefined;

    // Unknown UUID → empty series (not a 404)
    if (!secRow) {
      results.push({
        securityId,
        securityName: 'Unknown',
        currency: baseCurrency,
        series: [],
      });
      continue;
    }

    const secCurrency = secRow.currency ?? baseCurrency;
    const securityName = resolveSecurityName(secRow);

    // Fetch prices with 90-day lookback for forward-fill seeding
    const priceRows = sqlite.prepare(
      `SELECT tstamp, value FROM price
       WHERE security = ? AND tstamp >= ? AND tstamp <= ?
       ORDER BY tstamp ASC`
    ).all(securityId, lookbackStart, period.end) as PriceRow[];

    if (priceRows.length === 0) {
      results.push({
        securityId,
        securityName,
        currency: baseCurrency,
        series: [],
      });
      continue;
    }

    // Build FX rate map (security currency → base currency)
    const needsFx = secCurrency !== baseCurrency;
    const rateMap = needsFx
      ? buildRateMap(sqlite, secCurrency, baseCurrency, lookbackStart, period.end)
      : null;

    // Convert prices to Decimal and apply FX if needed
    const prices: Array<{ date: string; value: Decimal }> = [];
    for (const row of priceRows) {
      const date = row.tstamp.slice(0, 10); // normalize to yyyy-MM-dd
      let price = safeDecimal(row.value).div(1e8);

      if (rateMap !== null) {
        const rate = getRateFromMap(rateMap, date);
        if (rate !== null) {
          price = price.times(rate);
        } else {
          // No FX rate available — skip this price point, engine carry-forward handles gaps
          continue;
        }
      }

      prices.push({ date, value: price });
    }

    // Daimler optimization: only fetch portfolio cumulative if needed
    const hasPriceOnOrBeforePeriodStart = prices.some((p) => p.date <= period.start);
    if (!hasPriceOnOrBeforePeriodStart && portfolioCumulativeSeries === undefined) {
      portfolioCumulativeSeries = fetchPortfolioCumulativeSeries(sqlite, period);
    }

    // Compute benchmark series via engine
    const rawSeries = computeBenchmarkSeries({
      prices,
      periodStart: period.start,
      periodEnd: period.end,
      portfolioCumulativeSeries: hasPriceOnOrBeforePeriodStart
        ? undefined
        : portfolioCumulativeSeries,
    });

    // Convert Decimal → number for the response
    const converted = rawSeries.map((p) => ({
      date: p.date,
      cumulative: p.cumulative.toNumber(),
    }));

    const sampled = sampleSeries(converted, interval, period.start, calendarId);

    results.push({
      securityId,
      securityName,
      currency: baseCurrency,
      series: sampled,
    });
  }

  return results;
}
