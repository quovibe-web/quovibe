import type { TFunction } from 'react-i18next';
import type { ReportingPeriodDef } from '@quovibe/shared';
import { formatDate } from './formatters';
import { format, parseISO } from 'date-fns';
import { getDateLocale } from './formatters';

// ---------------------------------------------------------------------------
// Default periods — always visible in TopBar and Settings
// ---------------------------------------------------------------------------

export const DEFAULT_PERIODS: ReportingPeriodDef[] = [
  { type: 'lastYearsMonths', years: 1, months: 0 },
  { type: 'lastYearsMonths', years: 3, months: 0 },
  { type: 'currentYTD' },
];

// ---------------------------------------------------------------------------
// Period IDs — deterministic string identifier for each period definition
// ---------------------------------------------------------------------------

function formatYearsMonths(years: number, months: number): string {
  if (years > 0 && months === 0) return `${years}Y`;
  if (years === 0 && months > 0) return `${months}M`;
  return `${years}Y${months}M`;
}

/** Generate a stable ID for a ReportingPeriodDef (used for sidecar persistence). */
export function getPeriodId(period: ReportingPeriodDef): string {
  switch (period.type) {
    case 'lastYearsMonths':
      return formatYearsMonths(period.years, period.months);
    case 'lastDays':
      return `${period.days}D`;
    case 'lastTradingDays':
      return `${period.days}TD`;
    case 'fromTo':
      return `fromTo:${period.from}:${period.to}`;
    case 'since':
      return `since:${period.date}`;
    case 'year':
      return `year:${period.year}`;
    case 'currentYTD':
      return 'YTD';
    case 'currentWeek':
      return 'currentWeek';
    case 'currentMonth':
      return 'currentMonth';
    case 'currentQuarter':
      return 'currentQuarter';
    case 'previousDay':
      return 'previousDay';
    case 'previousTradingDay':
      return 'previousTradingDay';
    case 'previousWeek':
      return 'previousWeek';
    case 'previousMonth':
      return 'previousMonth';
    case 'previousQuarter':
      return 'previousQuarter';
    case 'previousYear':
      return 'previousYear';
  }
}

/** Special period ID for "ALL" (first transaction date → today). */
export const ALL_PERIOD_ID = 'ALL';

// ---------------------------------------------------------------------------
// formatPeriodLabel — human-readable label for a ReportingPeriodDef
// ---------------------------------------------------------------------------

export function formatPeriodLabel(period: ReportingPeriodDef, t: TFunction): string {
  switch (period.type) {
    case 'lastYearsMonths': {
      const { years, months } = period;
      if (years > 0 && months === 0) {
        return t('periods.labels.lastYears', { count: years, ns: 'settings' });
      }
      if (years === 0 && months > 0) {
        return t('periods.labels.lastMonths', { count: months, ns: 'settings' });
      }
      return t('periods.labels.lastYearsMonths', { years, months, ns: 'settings' });
    }

    case 'lastDays':
      return t('periods.labels.lastDays', { count: period.days, ns: 'settings' });

    case 'lastTradingDays':
      return t('periods.labels.lastTradingDays', { count: period.days, ns: 'settings' });

    case 'fromTo':
      return t('periods.labels.fromTo', {
        from: formatDate(period.from),
        to: formatDate(period.to),
        ns: 'settings',
      });

    case 'since':
      return t('periods.labels.since', { date: formatDate(period.date), ns: 'settings' });

    case 'year':
      return String(period.year);

    case 'currentWeek':
      return t('periods.labels.currentWeek', { ns: 'settings' });

    case 'currentMonth':
      return t('periods.labels.currentMonth', { ns: 'settings' });

    case 'currentQuarter':
      return t('periods.labels.currentQuarter', { ns: 'settings' });

    case 'currentYTD':
      return t('periods.labels.currentYTD', { ns: 'settings' });

    case 'previousDay':
      return t('periods.labels.previousDay', { ns: 'settings' });

    case 'previousTradingDay':
      return t('periods.labels.previousTradingDay', { ns: 'settings' });

    case 'previousWeek':
      return t('periods.labels.previousWeek', { ns: 'settings' });

    case 'previousMonth':
      return t('periods.labels.previousMonth', { ns: 'settings' });

    case 'previousQuarter':
      return t('periods.labels.previousQuarter', { ns: 'settings' });

    case 'previousYear':
      return t('periods.labels.previousYear', { ns: 'settings' });
  }
}

// ---------------------------------------------------------------------------
// formatPeriodShortLabel — compact label for TopBar pills
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// formatPeriodRange — compact "dd MMM – dd MMM yyyy" from resolved date strings
// ---------------------------------------------------------------------------

export function formatPeriodRange(periodStart: string, periodEnd: string, lng?: string): string {
  const locale = getDateLocale(lng);
  const start = parseISO(periodStart);
  const end = parseISO(periodEnd);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = format(start, sameYear ? 'dd MMM' : 'dd MMM yyyy', { locale });
  const endStr = format(end, 'dd MMM yyyy', { locale });
  return `${startStr} – ${endStr}`;
}

// ---------------------------------------------------------------------------
// Period-sensitive navigation helpers (shared by Sidebar + CommandPalette)
// ---------------------------------------------------------------------------

// Suffixes (relative to the portfolio scope) that carry period search params.
// Path shape is always `/p/:portfolioId/<suffix>`, or `/p/:portfolioId` for the
// portfolio root (= dashboard). Empty string matches the root.
const PERIOD_SENSITIVE_SUFFIXES = ['', 'analytics', 'allocation', 'investments', 'accounts', 'taxonomies'];

const SCOPED_PATH_RE = /^\/p\/[0-9a-f-]{36}(?:\/(.*))?$/i;

/** Check if a route path should carry period search params. */
export function isPeriodSensitivePath(path: string): boolean {
  const m = SCOPED_PATH_RE.exec(path);
  if (!m) return false;
  const suffix = m[1] ?? '';                         // '' → portfolio root (dashboard)
  return PERIOD_SENSITIVE_SUFFIXES.some((s) =>
    s === '' ? suffix === '' : suffix === s || suffix.startsWith(`${s}/`),
  );
}

/** Extract periodStart & periodEnd from a search string, returning a query string. */
export function extractPeriodSearch(search: string): string {
  const params = new URLSearchParams(search);
  const ps = params.get('periodStart');
  const pe = params.get('periodEnd');
  if (!ps || !pe) return '';
  return `?periodStart=${ps}&periodEnd=${pe}`;
}

const SHORT_LABEL_MAX_LENGTH = 20;

export function formatPeriodShortLabel(period: ReportingPeriodDef, t: TFunction): string {
  switch (period.type) {
    case 'lastYearsMonths':
      return formatYearsMonths(period.years, period.months);

    case 'currentYTD':
      return 'YTD';

    default: {
      const full = formatPeriodLabel(period, t);
      return full.length > SHORT_LABEL_MAX_LENGTH
        ? full.slice(0, SHORT_LABEL_MAX_LENGTH - 1) + '…'
        : full;
    }
  }
}
