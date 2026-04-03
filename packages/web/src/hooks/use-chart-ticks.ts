import { useMemo } from 'react';
import { parseISO, format, differenceInMonths } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { getDateLocale, formatDate } from '@/lib/formatters';

interface ChartTicksResult {
  /** Subset of ISO date strings to use as tick positions */
  ticks: string[];
  /** date-fns format string for tick labels */
  dateFormat: string;
  /** Ready-to-use tickFormatter for Recharts XAxis */
  tickFormatter: (iso: string) => string;
  /** Ready-to-use labelFormatter for Recharts Tooltip (full date) */
  labelFormatter: (label: unknown) => string;
}

/**
 * Computes smart tick positions and date format for Recharts XAxis
 * based on the date range of the data. Avoids duplicate labels
 * by selecting meaningful dates (evenly spaced, monthly, or quarterly).
 *
 * Reactive to i18next language changes.
 *
 * @param dates - Array of ISO date strings (yyyy-MM-dd), must be sorted ascending
 */
export function useChartTicks(dates: string[]): ChartTicksResult {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  return useMemo(() => {
    const locale = getDateLocale(lang);

    const fmt = (iso: string, pattern: string) => {
      try { return format(parseISO(iso), pattern, { locale }); }
      catch { return iso; }
    };

    const fmtFull = (label: unknown) => {
      if (typeof label !== 'string') return String(label ?? '');
      return formatDate(label, lang);
    };

    if (dates.length < 2) {
      return {
        ticks: [...dates],
        dateFormat: 'dd MMM',
        tickFormatter: (iso: string) => fmt(iso, 'dd MMM'),
        labelFormatter: fmtFull,
      };
    }

    const first = parseISO(dates[0]);
    const last = parseISO(dates[dates.length - 1]);
    const months = differenceInMonths(last, first);

    if (months <= 3) {
      // Short range: ~12 evenly spaced ticks
      const step = Math.max(1, Math.floor(dates.length / 12));
      const picked = dates.filter((_, i) => i % step === 0 || i === dates.length - 1);
      const pattern = 'dd MMM';
      return {
        ticks: picked,
        dateFormat: pattern,
        tickFormatter: (iso: string) => fmt(iso, pattern),
        labelFormatter: fmtFull,
      };
    }

    if (months <= 18) {
      // Medium range: first data point per month
      const seen = new Set<string>();
      const picked: string[] = [];
      for (const d of dates) {
        const key = d.slice(0, 7); // "yyyy-MM"
        if (!seen.has(key)) { seen.add(key); picked.push(d); }
      }
      const pattern = 'MMM yyyy';
      return {
        ticks: picked,
        dateFormat: pattern,
        tickFormatter: (iso: string) => fmt(iso, pattern),
        labelFormatter: fmtFull,
      };
    }

    // Long range: first data point per quarter
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const d of dates) {
      const p = parseISO(d);
      const q = Math.floor(p.getMonth() / 3);
      const key = `${p.getFullYear()}-Q${q}`;
      if (!seen.has(key)) { seen.add(key); picked.push(d); }
    }
    const pattern = "MMM ''yy";
    return {
      ticks: picked,
      dateFormat: pattern,
      tickFormatter: (iso: string) => fmt(iso, pattern),
      labelFormatter: fmtFull,
    };
  }, [dates, lang]);
}
