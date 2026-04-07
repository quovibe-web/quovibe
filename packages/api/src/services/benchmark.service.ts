import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import { differenceInCalendarDays, parseISO, format } from 'date-fns';
import type { BenchmarkSeriesItem } from '@quovibe/shared';
import { isTradingDay } from '@quovibe/shared';
import {
  computeBenchmarkSeries,
  getRateFromMap,
} from '@quovibe/engine';
import type { ChartInterval } from './performance.service';
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

    // Compute benchmark series via engine
    const rawSeries = computeBenchmarkSeries({
      prices,
      periodStart: period.start,
      periodEnd: period.end,
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
