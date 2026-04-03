// Reporting period — date range for performance calculations
// Uses an exclusive lower boundary for performance calculations ('>periodStart', not '>=').
// This resolver converts a ReportingPeriodDef into concrete { periodStart, periodEnd } date
// strings, where periodStart is the excluded boundary (day before the inclusive start).
//
// Key conventions implemented here:
//   - "Year 2025" → Dec 31 2024 (excluded) to Dec 31 2025 (included)
//   - "Current YTD" → Dec 31 prior year (excluded) to today
//   - "Current week" uses ISO 8601 Monday-based week start
//   - "Last N trading days" counts backward using the given (or default) calendar

import {
  subYears,
  subMonths,
  subDays,
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  endOfWeek,
  format,
  parseISO,
} from 'date-fns';
import { isTradingDay } from './calendars/calendar-utils';
import type { ReportingPeriodDef } from './schemas/settings.schema';

function fmt(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function dayBefore(d: Date): Date {
  return subDays(d, 1);
}

function getPreviousTradingDay(calendarId: string, dateStr: string): string {
  let current = dateStr;
  // 30-day limit: covers the longest plausible public holiday gap (~16 days globally)
  for (let i = 0; i < 30; i++) {
    const d = parseISO(current);
    const prev = subDays(d, 1);
    const prevStr = fmt(prev);
    if (isTradingDay(calendarId, prevStr)) return prevStr;
    current = prevStr;
  }
  return current;
}

/**
 * Resolves a semantic reporting period definition into concrete date strings.
 *
 * The returned `periodStart` is an **exclusive** lower boundary — the day before
 * the first included date. SQL callers must use `> periodStart`, not `>=`.
 *
 * @param period - Semantic period definition (from settings or URL params).
 * @param today - Override for today's date (`yyyy-MM-dd`). Defaults to system date.
 * @param calendarId - Calendar to use for trading-day calculations. Defaults to `'default'`.
 * @returns `{ periodStart, periodEnd }` — both in `yyyy-MM-dd` format.
 */
export function resolveReportingPeriod(
  period: ReportingPeriodDef,
  today?: string,
  calendarId?: string,
): { periodStart: string; periodEnd: string } {
  const todayDate = today ? parseISO(today) : new Date();
  const todayStr = today ?? fmt(todayDate);
  const cal = calendarId ?? 'default';

  switch (period.type) {
    case 'lastYearsMonths': {
      const start = subMonths(subYears(todayDate, period.years), period.months);
      return { periodStart: fmt(start), periodEnd: todayStr };
    }

    case 'lastDays': {
      const start = subDays(todayDate, period.days);
      return { periodStart: fmt(start), periodEnd: todayStr };
    }

    case 'lastTradingDays': {
      const periodCal = period.calendarId ?? cal;
      let current = todayStr;
      let count = 0;
      // Upper bound: ~3 calendar days per trading day + 30-day holiday buffer
      const maxIter = period.days * 3 + 30; // native-ok: loop counter, not financial value
      for (let i = 0; i < maxIter && count < period.days; i++) {
        const d = parseISO(current);
        const prev = subDays(d, 1);
        const prevStr = fmt(prev);
        if (isTradingDay(periodCal, prevStr)) count++;
        current = prevStr;
      }
      return { periodStart: current, periodEnd: todayStr };
    }

    case 'fromTo':
      return { periodStart: period.from, periodEnd: period.to };

    case 'since':
      return { periodStart: period.date, periodEnd: todayStr };

    case 'year':
      // "Year 2025" → excluded boundary Dec 31 2024 → Dec 31 2025
      return {
        periodStart: `${period.year - 1}-12-31`,
        periodEnd: `${period.year}-12-31`,
      };

    case 'currentWeek': {
      // ISO 8601: week starts on Monday (weekStartsOn: 1)
      // excluded boundary = day before Monday = Sunday
      const weekStart = startOfWeek(todayDate, { weekStartsOn: 1 });
      return { periodStart: fmt(dayBefore(weekStart)), periodEnd: todayStr };
    }

    case 'currentMonth': {
      const monthStart = startOfMonth(todayDate);
      return { periodStart: fmt(dayBefore(monthStart)), periodEnd: todayStr };
    }

    case 'currentQuarter': {
      const quarterStart = startOfQuarter(todayDate);
      return { periodStart: fmt(dayBefore(quarterStart)), periodEnd: todayStr };
    }

    case 'currentYTD': {
      const yearStart = startOfYear(todayDate);
      return { periodStart: fmt(dayBefore(yearStart)), periodEnd: todayStr };
    }

    case 'previousDay': {
      const yesterday = subDays(todayDate, 1);
      return { periodStart: fmt(dayBefore(yesterday)), periodEnd: fmt(yesterday) };
    }

    case 'previousTradingDay': {
      const prevTD = getPreviousTradingDay(cal, todayStr);
      const prevTDDate = parseISO(prevTD);
      return { periodStart: fmt(dayBefore(prevTDDate)), periodEnd: prevTD };
    }

    case 'previousWeek': {
      const thisWeekStart = startOfWeek(todayDate, { weekStartsOn: 1 });
      const prevWeekStart = subDays(thisWeekStart, 7);
      const prevWeekEnd = endOfWeek(prevWeekStart, { weekStartsOn: 1 });
      return { periodStart: fmt(dayBefore(prevWeekStart)), periodEnd: fmt(prevWeekEnd) };
    }

    case 'previousMonth': {
      const thisMonthStart = startOfMonth(todayDate);
      const prevMonthStart = startOfMonth(subMonths(thisMonthStart, 1));
      const prevMonthEnd = endOfMonth(prevMonthStart);
      return { periodStart: fmt(dayBefore(prevMonthStart)), periodEnd: fmt(prevMonthEnd) };
    }

    case 'previousQuarter': {
      const thisQuarterStart = startOfQuarter(todayDate);
      const prevQuarterStart = startOfQuarter(subMonths(thisQuarterStart, 1));
      const prevQuarterEnd = endOfQuarter(prevQuarterStart);
      return { periodStart: fmt(dayBefore(prevQuarterStart)), periodEnd: fmt(prevQuarterEnd) };
    }

    case 'previousYear': {
      const prevYearStart = startOfYear(subYears(todayDate, 1));
      const prevYearEnd = endOfYear(prevYearStart);
      return { periodStart: fmt(dayBefore(prevYearStart)), periodEnd: fmt(prevYearEnd) };
    }

    default: {
      const _exhaustive: never = period;
      throw new Error(`Unhandled period type: ${(_exhaustive as ReportingPeriodDef).type}`);
    }
  }
}
