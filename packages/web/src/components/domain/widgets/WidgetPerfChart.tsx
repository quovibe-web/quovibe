import { useState, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useWidgetChartCalculation } from '@/hooks/use-widget-chart-calculation';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useChartTheme } from '@/hooks/use-chart-theme';
import { useChartTicks } from '@/hooks/use-chart-ticks';
import { differenceInDays, parseISO } from 'date-fns';
import { formatPercentage, formatCurrency, formatDate, computeTtwrorPa } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChartTooltip, ChartTooltipRow } from '@/components/shared/ChartTooltip';
import { ChartLegend } from '@/components/shared/ChartLegend';
import { FadeIn } from '@/components/shared/FadeIn';
import i18n from '@/i18n';

export default function WidgetPerfChart() {
  const { t } = useTranslation('performance');
  const { t: tDash } = useTranslation('dashboard');
  const { isPrivate } = usePrivacy();
  const { profit, dividend } = useChartColors();
  const { gridColor, gridOpacity, tickColor, cursorColor, cursorDasharray } = useChartTheme();

  const [ttwrorMode, setTtwrorMode] = useState<'cumulative' | 'annualized'>('cumulative');

  const uid = useId();
  const gradientId = `colorMvWidget-${uid.replace(/:/g, '')}`;

  const { data, isLoading, isError, error, periodStart, isFetching } = useWidgetChartCalculation();

  const chartData = useMemo(
    () =>
      (data ?? []).map((p) => ({
        date: p.date,
        marketValue: parseFloat(p.marketValue),
        ttwror: parseFloat(p.ttwrorCumulative),
      })),
    [data],
  );

  const displayData = useMemo(() => {
    if (ttwrorMode === 'cumulative') return chartData;
    const start = parseISO(periodStart);
    return chartData.map((p) => ({
      ...p,
      ttwror: computeTtwrorPa(p.ttwror, differenceInDays(parseISO(p.date), start)),
    }));
  }, [chartData, ttwrorMode, periodStart]);

  const chartDates = useMemo(() => chartData.map((d) => d.date), [chartData]);
  const { ticks, tickFormatter } = useChartTicks(chartDates);

  const mvTickFormatter = useMemo(() => {
    const fmt = new Intl.NumberFormat(i18n.language, {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    return (v: number) => fmt.format(v);
  }, []);

  if (isLoading) {
    return (
      <div className="relative" style={{ height: 250 }}>
        <Skeleton className="w-full h-full rounded-lg" />
      </div>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }
  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-muted-foreground">
        {tDash('noChartData')}
      </div>
    );
  }

  const ttwrorLabel = ttwrorMode === 'cumulative' ? t('chart.ttwror') : t('chart.ttwrorPa');

  return (
    <FadeIn>
    <div
      className={cn('relative', isFetching && !isLoading && 'opacity-60 transition-opacity duration-200')}
      style={{
        filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
        transition: 'filter 0.2s ease',
      }}
    >
      <div className="absolute -top-12 right-0 z-10">
        <div className="inline-flex rounded-md border border-border bg-muted/50 p-0.5">
          <button
            className={cn(
              'px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              ttwrorMode === 'cumulative'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTtwrorMode('cumulative')}
          >
            {t('chart.cumulative')}
          </button>
          <button
            className={cn(
              'px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              ttwrorMode === 'annualized'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTtwrorMode('annualized')}
          >
            {t('chart.annualizedPa')}
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={displayData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={profit} stopOpacity={0.25} />
              <stop offset="95%" stopColor={profit} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={gridColor}
            strokeOpacity={gridOpacity}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: tickColor, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            ticks={ticks}
            tickFormatter={tickFormatter}
          />
          <YAxis
            yAxisId="mv"
            orientation="left"
            tick={{ fill: tickColor, fontSize: 10, style: { fontFeatureSettings: '"tnum"' } }}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={mvTickFormatter}
            width={50}
          />
          <YAxis
            yAxisId="ttwror"
            orientation="right"
            tick={{ fill: tickColor, fontSize: 10, style: { fontFeatureSettings: '"tnum"' } }}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            tickFormatter={(v: number) => formatPercentage(v)}
            width={55}
          />
          <Tooltip
            cursor={{ stroke: cursorColor, strokeDasharray: cursorDasharray }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <ChartTooltip label={formatDate(label as string)}>
                  {payload.map((entry) => {
                    const key = entry.dataKey as string;
                    const val = entry.value as number;
                    if (key === 'marketValue') {
                      return (
                        <ChartTooltipRow
                          key={key}
                          color={profit}
                          label={t('chart.marketValue')}
                          value={formatCurrency(val)}
                        />
                      );
                    }
                    if (key === 'ttwror') {
                      return (
                        <ChartTooltipRow
                          key={key}
                          color={dividend}
                          label={ttwrorLabel}
                          value={formatPercentage(val)}
                        />
                      );
                    }
                    return null;
                  })}
                </ChartTooltip>
              );
            }}
          />
          <Area
            yAxisId="mv"
            type="monotone"
            dataKey="marketValue"
            stroke={profit}
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            dot={false}
            name={t('chart.marketValue')}
            animationDuration={800}
            animationEasing="ease-out"
          />
          <Line
            key={ttwrorMode}
            yAxisId="ttwror"
            type="monotone"
            dataKey="ttwror"
            stroke={dividend}
            strokeWidth={2}
            dot={false}
            name={ttwrorLabel}
            animationDuration={800}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { color: profit, label: t('chart.marketValue'), type: 'dot' },
          { color: dividend, label: ttwrorLabel, type: 'line' },
        ]}
        className="text-[10px]"
      />
    </div>
    </FadeIn>
  );
}
