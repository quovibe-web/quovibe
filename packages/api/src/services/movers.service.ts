import type BetterSqlite3 from 'better-sqlite3';
import type { Decimal } from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import {
  fetchBatchData,
  computeAllSecurities,
  buildCalcScope,
  type SecurityPerfInternal,
  type BatchData,
} from './performance.service';

interface SparklinePoint {
  date: string;
  cumR: string;
}

export interface MoverEntry {
  securityId: string;
  name: string;
  ttwror: string;
  sparkline: SparklinePoint[];
}

export interface MoversResponse {
  periodStart: string;
  periodEnd: string;
  top: MoverEntry[];
  bottom: MoverEntry[];
}

const MAX_SPARKLINE_POINTS = 30;

/**
 * Reduce a daily-returns array to at most `maxPoints` evenly-spaced entries.
 * Always includes the last point so the sparkline ends at the correct value.
 */
export function downsample(
  dailyReturns: Array<{ date: string; r: Decimal; cumR: Decimal }>,
  maxPoints: number = MAX_SPARKLINE_POINTS,
): SparklinePoint[] {
  if (dailyReturns.length === 0) return [];
  if (dailyReturns.length <= maxPoints) {
    return dailyReturns.map((d) => ({ date: d.date, cumR: d.cumR.toString() }));
  }
  const step = Math.ceil(dailyReturns.length / maxPoints); // native-ok
  const result: SparklinePoint[] = [];
  for (let i = 0; i < dailyReturns.length; i += step) { // native-ok
    result.push({ date: dailyReturns[i].date, cumR: dailyReturns[i].cumR.toString() });
  }
  const last = dailyReturns[dailyReturns.length - 1]; // native-ok
  if (result[result.length - 1].date !== last.date) { // native-ok
    result.push({ date: last.date, cumR: last.cumR.toString() });
  }
  return result;
}

/**
 * Split N items into top/bottom buckets:
 *   topN = ceil(total / 2), bottomN = total - topN.
 * Never returns the same security in both lists.
 */
function splitTopBottom(
  sorted: SecurityPerfInternal[],
  count: number,
): { top: SecurityPerfInternal[]; bottom: SecurityPerfInternal[] } {
  const total = sorted.length; // native-ok
  if (total === 0) return { top: [], bottom: [] };

  const effectiveCount = Math.min(count, Math.ceil(total / 2)); // native-ok
  const top = sorted.slice(0, effectiveCount);

  // Bottom: take from the end, but never overlap with top
  const bottomStart = Math.max(effectiveCount, total - effectiveCount); // native-ok
  const bottom = sorted.slice(bottomStart);

  return { top, bottom };
}

function toMoverEntry(
  sr: SecurityPerfInternal,
  securityInfoMap: Map<string, { name: string; isin?: string }>,
): MoverEntry {
  const info = securityInfoMap.get(sr.securityId);
  return {
    securityId: sr.securityId,
    name: info?.name ?? sr.securityId,
    ttwror: sr.ttwror.toString(),
    sparkline: downsample(sr.dailyReturns),
  };
}

export function getMovers(
  sqlite: BetterSqlite3.Database,
  period: { start: string; end: string },
  count: number = 3,
  costMethod: CostMethod = CostMethod.MOVING_AVERAGE,
  preTax = false,
  scope?: ReturnType<typeof buildCalcScope>,
): MoversResponse {
  const data: BatchData = fetchBatchData(sqlite, period);
  const secFilter = scope?.securityIds;
  const secResults = computeAllSecurities(data, period, costMethod, preTax, secFilter);

  // Filter out securities with zero shares at period end (not held)
  const held = secResults.filter((sr) => sr.sharesEnd.gt(0));

  // Sort descending by TTWROR
  held.sort((a, b) => b.ttwror.comparedTo(a.ttwror));

  const { top, bottom } = splitTopBottom(held, count);

  return {
    periodStart: period.start,
    periodEnd: period.end,
    top: top.map((sr) => toMoverEntry(sr, data.securityInfoMap)),
    bottom: bottom.reverse().map((sr) => toMoverEntry(sr, data.securityInfoMap)),
  };
}
