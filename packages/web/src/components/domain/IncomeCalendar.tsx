import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import { usePayments } from '@/api/use-reports';
import { usePrivacy } from '@/context/privacy-context';
import { getCssVarRgb } from '@/lib/colors';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import {
  computeMonthlyAverages,
  computeYearDelta,
  sparkbarIndex,
  SPARKBAR_GLYPHS,
} from './IncomeCalendar.utils';
import type { PaymentGroup, Payment } from '@/api/types';

type AmountMode = 'gross' | 'net';

interface CellBreakdown {
  bucket: string;
  total: number;
  div: number;
  int: number;
  count: number;
}

function pickPaymentAmount(p: Payment, mode: AmountMode): number {
  return parseFloat(mode === 'gross' ? p.grossAmount : p.netAmount);
}

function parseMonthBucket(bucket: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(bucket);
  if (!m) return null;
  return { year: parseInt(m[1]!, 10), month: parseInt(m[2]!, 10) };
}

interface CalendarGrid {
  cells: Map<number, Map<number, CellBreakdown>>;
  yearTotals: Map<number, number>;
  maxCell: number;
  maxYear: number;
  totalCells: number;
  grandTotal: number;
}

function buildGrid(groups: PaymentGroup[], mode: AmountMode): CalendarGrid {
  const cells = new Map<number, Map<number, CellBreakdown>>();
  const yearTotals = new Map<number, number>();
  let maxCell = 0;
  let totalCells = 0;
  let grandTotal = 0;

  for (const g of groups) {
    const ym = parseMonthBucket(g.bucket);
    if (!ym) continue;
    let total = 0;
    let div = 0;
    let int = 0;
    for (const p of g.payments) {
      const v = pickPaymentAmount(p, mode);
      total += v;
      if (p.type === 'DIVIDEND') div += v;
      else int += v;
    }
    if (!cells.has(ym.year)) cells.set(ym.year, new Map());
    cells.get(ym.year)!.set(ym.month, { bucket: g.bucket, total, div, int, count: g.count });
    yearTotals.set(ym.year, (yearTotals.get(ym.year) ?? 0) + total);
    grandTotal += total;
    if (total > maxCell) maxCell = total;
    totalCells += 1;
  }
  let maxYear = 0;
  for (const v of yearTotals.values()) if (v > maxYear) maxYear = v;
  return { cells, yearTotals, maxCell, maxYear, totalCells, grandTotal };
}

function cellBg(value: number, maxValue: number, rgb: [number, number, number] | null): string {
  if (maxValue <= 0 || value <= 0 || rgb === null) return 'transparent';
  const t = Math.min(value / maxValue, 1);
  const eased = Math.sqrt(t);
  const alpha = 0.08 + eased * 0.72;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
}

interface IncomeCalendarProps {
  amountMode: AmountMode;
  pageGroupBy: 'month' | 'quarter' | 'year' | 'security' | 'type';
  onMonthClick?: (bucket: string) => void;
}

export function IncomeCalendar({ amountMode, pageGroupBy, onMonthClick }: IncomeCalendarProps) {
  const { t } = useTranslation('reports');
  const { data, isLoading } = usePayments('month');
  const { isPrivate } = usePrivacy();
  const { resolvedTheme } = useTheme();

  const monthsShort = t('returnsHeatmap.months', { returnObjects: true }) as string[];
  const monthsFull = t('returnsHeatmap.monthsFull', { returnObjects: true }) as string[];

  const grid = useMemo(
    () => buildGrid(data?.combinedGroups ?? [], amountMode),
    [data, amountMode],
  );

  // resolvedTheme dep: getCssVarRgb reads the live CSS var which differs across modes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cellRgb = useMemo<[number, number, number] | null>(
    () => getCssVarRgb('--color-chart-1') ?? [67, 133, 190],
    [resolvedTheme],
  );

  const years = useMemo(
    () => Array.from(grid.cells.keys()).sort((a, b) => a - b),
    [grid],
  );

  const monthlyAvg = useMemo(() => computeMonthlyAverages(grid.cells), [grid]);

  // Header chips: Avg/mo + YoY
  const avgPerMonth = grid.totalCells > 0 ? grid.grandTotal / grid.totalCells : 0;
  const latestYear = years[years.length - 1];
  const latestYoY =
    latestYear !== undefined ? computeYearDelta(latestYear, grid.yearTotals) : null;

  const isInteractive = pageGroupBy === 'month';
  const handleCellClick = useCallback(
    (bucket: string) => {
      if (onMonthClick) {
        onMonthClick(bucket);
        return;
      }
      // Fallback (defensive — onMonthClick should always be provided once Payments.tsx is wired)
      const el = document.getElementById(`income-month-${bucket}`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('qv-bucket-flash');
      window.setTimeout(() => el.classList.remove('qv-bucket-flash'), 1400);
    },
    [onMonthClick],
  );

  if (isLoading) return <ChartSkeleton height={200} />;
  if (grid.totalCells === 0) return null;

  return (
    <Card className="rounded-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-medium">{t('payments.calendar.title')}</CardTitle>
        <div className="flex items-center gap-3 text-xs text-[var(--qv-text-faint)]">
          <span className="qv-numeric">
            {t('payments.calendar.headerChipAvg', { value: formatNumber(avgPerMonth, { notation: 'compact', maximumFractionDigits: 1 }) })}
          </span>
          {latestYoY && latestYear !== undefined && (
            <span className={`qv-numeric ${latestYoY.isUp ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]'}`}>
              {latestYoY.isUp
                ? t('payments.calendar.headerChipYoy', { year: String(latestYear - 1).slice(-2) })
                : t('payments.calendar.headerChipYoyDown', { year: String(latestYear - 1).slice(-2) })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={100}>
          <div
            className="overflow-x-auto"
            style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}
          >
            <table className="w-full text-[11px] border-separate border-spacing-[2px]">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left qv-eyebrow text-[10px]">
                    {t('payments.calendar.yearLabel')}
                  </th>
                  {monthsShort.map((m) => (
                    <th key={m} className="px-1 py-1 text-center qv-eyebrow text-[10px] min-w-[48px]">
                      {m}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-center qv-eyebrow text-[10px] min-w-[64px]">
                    {t('payments.calendar.total')}
                  </th>
                  <th className="px-2 py-1 text-center qv-eyebrow text-[10px] min-w-[40px]">
                    {t('payments.calendar.deltaHeader')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {years.map((year) => {
                  const months = grid.cells.get(year)!;
                  const yearTotal = grid.yearTotals.get(year) ?? 0;
                  const yDelta = computeYearDelta(year, grid.yearTotals);
                  return (
                    <tr key={year}>
                      <td className="px-2 py-1 qv-numeric text-foreground font-medium">{year}</td>
                      {monthsShort.map((_, i) => {
                        const month = i + 1;
                        const cell = months.get(month);
                        if (!cell) {
                          return (
                            <td
                              key={month}
                              className="rounded-[4px]"
                              style={{ backgroundColor: 'var(--qv-surface-elevated)', opacity: 0.4 }}
                            />
                          );
                        }
                        const cellLabel = formatNumber(cell.total, { notation: 'compact', maximumFractionDigits: 1 });
                        const cellBgStyle = { backgroundColor: cellBg(cell.total, grid.maxCell, cellRgb) };
                        return (
                          <td key={month} className="p-0 rounded-[4px] overflow-hidden">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                {isInteractive ? (
                                  <button
                                    type="button"
                                    onClick={() => handleCellClick(cell.bucket)}
                                    aria-label={`${monthsFull[i]} ${year}`}
                                    className="w-full px-1 py-1.5 text-center qv-numeric text-[10px] text-foreground cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--qv-surface)]"
                                    style={cellBgStyle}
                                  >
                                    {cellLabel}
                                  </button>
                                ) : (
                                  <div
                                    aria-label={`${monthsFull[i]} ${year}`}
                                    className="w-full px-1 py-1.5 text-center qv-numeric text-[10px] text-foreground cursor-default"
                                    style={cellBgStyle}
                                  >
                                    {cellLabel}
                                  </div>
                                )}
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-0.5 text-xs">
                                  <div className="font-medium">{monthsFull[i]} {year}</div>
                                  <div>
                                    {t('payments.dividends')}:{' '}
                                    <span className="qv-numeric">{formatCurrency(cell.div)}</span>
                                  </div>
                                  <div>
                                    {t('payments.interest')}:{' '}
                                    <span className="qv-numeric">{formatCurrency(cell.int)}</span>
                                  </div>
                                  <div className="border-t border-[var(--qv-border-subtle)] pt-1 mt-1">
                                    {t('payments.calendar.totalLabel')}:{' '}
                                    <span className="qv-numeric font-medium">{formatCurrency(cell.total)}</span>
                                  </div>
                                  <div className="text-muted-foreground">
                                    {t('payments.paymentCount', { count: cell.count })}
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                      <td className="p-0 rounded-[4px] overflow-hidden">
                        <div
                          className="px-2 py-1.5 text-center qv-numeric text-[10px] text-foreground font-medium"
                          style={{ backgroundColor: cellBg(yearTotal, grid.maxYear, cellRgb) }}
                        >
                          {formatNumber(yearTotal, { notation: 'compact', maximumFractionDigits: 1 })}
                        </div>
                      </td>
                      <td className="px-1 py-1 text-center">
                        {yDelta ? (
                          <span className={`qv-numeric text-[10px] ${yDelta.isUp ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]'}`}>
                            {yDelta.isUp ? '+' : ''}{Math.round(yDelta.delta * 100)}%
                          </span>
                        ) : (
                          <span className="text-[var(--qv-text-faint)] text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* AVG sparkbar row */}
                <tr>
                  <td className="px-2 py-1 qv-eyebrow text-[10px] text-[var(--qv-text-faint)]">
                    {t('payments.calendar.averageRow')}
                  </td>
                  {monthsShort.map((_, i) => {
                    const avg = monthlyAvg.averages[i] ?? 0;
                    const idx = sparkbarIndex(avg, monthlyAvg.maxAverage);
                    return (
                      <td key={i} className="px-1 py-1 text-center text-[var(--qv-text-muted)] qv-numeric text-[11px] leading-none">
                        <div>{formatNumber(avg, { notation: 'compact', maximumFractionDigits: 1 })}</div>
                        <div className="text-[10px]">{SPARKBAR_GLYPHS[idx]}</div>
                      </td>
                    );
                  })}
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
