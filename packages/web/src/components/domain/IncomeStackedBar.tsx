import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseISO,
  eachMonthOfInterval,
  eachQuarterOfInterval,
  eachYearOfInterval,
  format,
  getYear,
  getQuarter,
} from 'date-fns';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useChartTheme } from '@/hooks/use-chart-theme';
import { useActiveBar } from '@/hooks/use-active-bar';
import { usePrivacy } from '@/context/privacy-context';
import { formatNumber } from '@/lib/formatters';
import { IncomeStackedBreakdownTooltip } from './IncomeStackedBreakdownTooltip';
import type { PaymentGroup } from '@/api/types';

type AmountMode = 'gross' | 'net';
type TimeGroupBy = 'month' | 'quarter' | 'year';

interface IncomeStackedBarProps {
  dividendGroups: PaymentGroup[];
  interestGroups: PaymentGroup[];
  amountMode: AmountMode;
  groupBy: TimeGroupBy;
  periodStart: string;
  periodEnd: string;
  onBarClick?: (bucket: string) => void;
}

const compactNumberFormat = (v: number) =>
  formatNumber(v, { notation: 'compact', maximumFractionDigits: 1 });

function bucketKeyForDate(d: Date, groupBy: TimeGroupBy): string {
  if (groupBy === 'year') return String(getYear(d));
  if (groupBy === 'quarter') return `${getYear(d)}-Q${getQuarter(d)}`;
  return format(d, 'yyyy-MM');
}

function buildSeries(
  dividendGroups: PaymentGroup[],
  interestGroups: PaymentGroup[],
  amountMode: AmountMode,
  groupBy: TimeGroupBy,
  periodStart: string,
  periodEnd: string,
): Array<{ bucket: string; dividend: number; interest: number }> {
  const start = parseISO(periodStart);
  const end = parseISO(periodEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const div = new Map<string, number>();
  for (const g of dividendGroups) {
    div.set(g.bucket, parseFloat(amountMode === 'gross' ? g.totalGross : g.totalNet));
  }
  const int = new Map<string, number>();
  for (const g of interestGroups) {
    int.set(g.bucket, parseFloat(amountMode === 'gross' ? g.totalGross : g.totalNet));
  }

  const dates =
    groupBy === 'month'
      ? eachMonthOfInterval({ start, end })
      : groupBy === 'quarter'
        ? eachQuarterOfInterval({ start, end })
        : eachYearOfInterval({ start, end });

  return dates
    .map((d) => {
      const bucket = bucketKeyForDate(d, groupBy);
      return {
        bucket,
        dividend: div.get(bucket) ?? 0,
        interest: int.get(bucket) ?? 0,
      };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

const ANCHORED_TOOLTIP_WRAPPER_STYLE = {
  outline: 'none',
  pointerEvents: 'none' as const,
  transition: 'none',
};

export function IncomeStackedBar({
  dividendGroups,
  interestGroups,
  amountMode,
  groupBy,
  periodStart,
  periodEnd,
  onBarClick,
}: IncomeStackedBarProps) {
  const { t } = useTranslation('reports');
  const { dividend, interest } = useChartColors();
  const { gridColor, gridOpacity, tickColor, isDark } = useChartTheme();
  const { isPrivate } = usePrivacy();
  const { barHandlers, tooltipProps } = useActiveBar();

  // Shared by both stacked <Bar> segments — navigate on a month-bucket click.
  const handleBarClick = (d: { payload?: { bucket?: string } }) => {
    const bucket = d.payload?.bucket;
    if (bucket && onBarClick && groupBy === 'month') onBarClick(bucket);
  };

  const data = useMemo(
    () => buildSeries(dividendGroups, interestGroups, amountMode, groupBy, periodStart, periodEnd),
    [dividendGroups, interestGroups, amountMode, groupBy, periodStart, periodEnd],
  );

  if (data.length === 0 || data.every((d) => d.dividend === 0 && d.interest === 0)) {
    return null;
  }

  const title = t(`payments.${amountMode === 'gross' ? 'incomePerGroupGross' : 'incomePerGroupNet'}`, {
    defaultValue: t('payments.dividendsPerGroup', { groupBy: t(`payments.groupBy.${groupBy}`) }),
    groupBy: t(`payments.groupBy.${groupBy}`),
  });

  return (
    <Card className="rounded-md mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <div className="flex items-center gap-3 text-xs text-[var(--qv-text-faint)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: dividend }} />
            {t('payments.dividends')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: interest }} />
            {t('payments.interest')}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={gridOpacity} vertical={false} />
              <XAxis
                dataKey="bucket"
                tick={{ fill: tickColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tick={{ fill: tickColor, fontSize: 11, style: { fontFeatureSettings: '"tnum"' } }}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                tickFormatter={compactNumberFormat}
              />
              <Tooltip
                {...tooltipProps}
                cursor={false}
                wrapperStyle={ANCHORED_TOOLTIP_WRAPPER_STYLE}
                content={<IncomeStackedBreakdownTooltip amountMode={amountMode} />}
              />
              <Bar
                dataKey="dividend"
                stackId="a"
                fill={dividend}
                animationDuration={600}
                animationEasing="ease-out"
                activeBar={{ style: { filter: isDark ? 'brightness(1.6) saturate(1.5)' : 'brightness(1.15) saturate(1.2)', transition: 'filter 0.15s ease' } }}
                {...barHandlers}
                onClick={handleBarClick}
              />
              <Bar
                dataKey="interest"
                stackId="a"
                fill={interest}
                radius={[3, 3, 0, 0]}
                animationDuration={600}
                animationEasing="ease-out"
                activeBar={{ style: { filter: isDark ? 'brightness(1.6) saturate(1.5)' : 'brightness(1.15) saturate(1.2)', transition: 'filter 0.15s ease' } }}
                {...barHandlers}
                onClick={handleBarClick}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
