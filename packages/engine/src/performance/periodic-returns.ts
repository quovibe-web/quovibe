import Decimal from 'decimal.js';
import { getISOWeek, getISOWeekYear, parseISO, getQuarter, getYear } from 'date-fns';

export type PeriodicInterval = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface PeriodicReturnEntry {
  date: string;
  return: string;
}

function bucketKey(date: string, interval: PeriodicInterval): string {
  switch (interval) {
    case 'daily':
      return date;
    case 'weekly': {
      const d = parseISO(date);
      return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`;
    }
    case 'monthly':
      return date.slice(0, 7);
    case 'quarterly': {
      const d = parseISO(date);
      return `${getYear(d)}-Q${getQuarter(d)}`;
    }
    case 'yearly':
      return date.slice(0, 4);
  }
}

export function aggregatePeriodicReturns(
  dailyReturns: Array<{ date: string; r: Decimal }>,
  interval: PeriodicInterval,
): PeriodicReturnEntry[] {
  if (dailyReturns.length === 0) return [];

  const ONE = new Decimal(1);
  const buckets = new Map<string, { product: Decimal; lastDate: string }>();

  for (const { date, r } of dailyReturns) {
    const key = bucketKey(date, interval);
    const existing = buckets.get(key);
    if (existing) {
      existing.product = existing.product.times(ONE.plus(r));
      if (date > existing.lastDate) existing.lastDate = date;
    } else {
      buckets.set(key, { product: ONE.plus(r), lastDate: date });
    }
  }

  const entries: PeriodicReturnEntry[] = [];
  for (const { product, lastDate } of buckets.values()) {
    entries.push({ date: lastDate, return: product.minus(ONE).toString() });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}
