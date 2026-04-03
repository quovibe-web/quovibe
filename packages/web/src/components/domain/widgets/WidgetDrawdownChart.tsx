import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart,
  Area,
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
import { formatPercentage, formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChartTooltip, ChartTooltipRow } from '@/components/shared/ChartTooltip';
import { FadeIn } from '@/components/shared/FadeIn';

export default function WidgetDrawdownChart() {
  const { t } = useTranslation('dashboard');
  const { isPrivate } = usePrivacy();
  const { danger } = useChartColors();
  const { gridColor, gridOpacity, tickColor, cursorColor, cursorDasharray } = useChartTheme();

  const uid = useId();
  const gradientId = `colorDdWidget-${uid.replace(/:/g, '')}`;

  const { data, isLoading, isError, error, isFetching } = useWidgetChartCalculation();

  const chartData = useMemo(
    () =>
      (data ?? []).map((p) => ({
        date: p.date,
        drawdown: -parseFloat(p.drawdown),
      })),
    [data],
  );

  const chartDates = useMemo(() => chartData.map((d) => d.date), [chartData]);
  const { ticks, tickFormatter } = useChartTicks(chartDates);

  if (isLoading) {
    return (
      <div className="relative" style={{ height: 280 }}>
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
        {t('noChartData')}
      </div>
    );
  }

  return (
    <FadeIn>
    <div
      className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity duration-200')}
      style={{
        filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
        transition: 'filter 0.2s ease',
      }}
    >
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={danger} stopOpacity={0.25} />
              <stop offset="95%" stopColor={danger} stopOpacity={0.02} />
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
              const val = payload[0].value as number;
              return (
                <ChartTooltip label={formatDate(label as string)}>
                  <ChartTooltipRow
                    color={danger}
                    label={t('widgetTypes.drawdown-chart')}
                    value={formatPercentage(val)}
                  />
                </ChartTooltip>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="drawdown"
            stroke={danger}
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            dot={false}
            animationDuration={800}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    </FadeIn>
  );
}
