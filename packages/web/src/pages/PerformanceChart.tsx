import {
  ComposedChart,
  Area,
  Line,
  Bar,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { differenceInDays, parseISO } from 'date-fns';
import { Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePerformanceChart, useReportingPeriod } from '@/api/use-performance';
import { useChartSeries } from '@/api/use-chart-series';
import { useSecurities } from '@/api/use-securities';
import { formatPercentage, computeTtwrorPa } from '@/lib/formatters';
import type { LineStyle, BarInterval } from '@quovibe/shared';
import { usePeriodicReturns } from '@/api/use-periodic-returns';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useChartTheme } from '@/hooks/use-chart-theme';
import { useChartTicks } from '@/hooks/use-chart-ticks';
import { ChartExportButton } from '@/components/shared/ChartExportButton';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import { ChartTooltip, ChartTooltipRow } from '@/components/shared/ChartTooltip';
import {
  InteractiveChartLegend,
  type LegendItem,
} from '@/components/shared/InteractiveChartLegend';
import { FadeIn } from '@/components/shared/FadeIn';
import { useAnalyticsContext } from '@/context/analytics-context';
import { DataSeriesPickerDialog } from '@/components/domain/DataSeriesPickerDialog';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/formatters';
import { useChartConfig, useSaveChartConfig } from '@/api/use-chart-config';


function getStrokeDasharray(style: LineStyle): string | undefined {
  switch (style) {
    case 'dashed': return '5 3';
    case 'dotted': return '2 2';
    default: return undefined;
  }
}

export default function PerformanceChart() {
  const { t } = useTranslation('performance');
  const { periodStart, periodEnd } = useReportingPeriod();
  const { data: chart, isLoading, isFetching } = usePerformanceChart({ periodStart, periodEnd });
  const { isPrivate } = usePrivacy();
  const { dividend, palette } = useChartColors();
  const { gridColor, gridOpacity, tickColor, cursorColor, cursorDasharray } = useChartTheme();

  const [configOpen, setConfigOpen] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [isolatedSeries, setIsolatedSeries] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const { data: chartConfig } = useChartConfig();
  const saveChartConfig = useSaveChartConfig();

  function toggleSeriesVisibility(id: string) {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (isolatedSeries) setIsolatedSeries(null);
  }

  function isolateSeries(id: string) {
    setIsolatedSeries((prev) => (prev === id ? null : id));
    setHiddenSeries(new Set());
  }

  function persistSeriesUpdate(id: string, patch: Record<string, unknown>) {
    if (!chartConfig) return;
    const updatedSeries = chartConfig.series.map((s) =>
      s.id === id ? { ...s, ...patch } : s,
    );
    saveChartConfig.mutate({ ...chartConfig, series: updatedSeries });
  }

  function handleColorChange(id: string, color: string) {
    persistSeriesUpdate(id, { color });
  }

  function handleLineStyleChange(id: string, style: string) {
    persistSeriesUpdate(id, { lineStyle: style });
  }

  function handleAreaFillToggle(id: string) {
    const series = chartConfig?.series.find((s) => s.id === id);
    if (!series) return;
    persistSeriesUpdate(id, { areaFill: !series.areaFill });
  }

  function handleRemoveSeries(id: string) {
    if (!chartConfig) return;
    const updatedSeries = chartConfig.series.filter((s) => s.id !== id);
    saveChartConfig.mutate({ ...chartConfig, series: updatedSeries });
  }

  function handleReorder(orderedIds: string[]) {
    if (!chartConfig) return;
    const updatedSeries = chartConfig.series.map((s) => {
      const idx = orderedIds.indexOf(s.id);
      return idx >= 0 ? { ...s, order: idx } : s;
    });
    saveChartConfig.mutate({ ...chartConfig, series: updatedSeries });
  }

  const { series: chartSeries } = useChartSeries();
  const { data: securities } = useSecurities();

  // Extract periodic_bars config from chart series
  const periodicBarsConfig = useMemo(() => {
    const cfg = chartSeries.find((rs) => rs.config.type === 'periodic_bars');
    return cfg?.config ?? null;
  }, [chartSeries]);

  const barInterval: BarInterval | null = periodicBarsConfig?.barInterval ?? null;
  const { data: periodicData } = usePeriodicReturns(barInterval);

  const { setActions, setSubtitle } = useAnalyticsContext();

  const [ttwrorMode, setTtwrorMode] = useState<'cumulative' | 'annualized'>('cumulative');

  useEffect(() => {
    setSubtitle(t('chart.subtitle'));
    return () => { setSubtitle(''); setActions(null); };
  }, [t, setSubtitle, setActions]);

  useEffect(() => {
    setActions(
      <>
        <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
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
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              ttwrorMode === 'annualized'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTtwrorMode('annualized')}
          >
            {t('chart.annualizedPa')}
          </button>
        </div>
        <ChartExportButton
          chartRef={chartContainerRef}
          filename={`performance-chart-${periodStart}-to-${periodEnd}`}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setConfigOpen(true)}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </>
    );
  }, [ttwrorMode, t, setActions, setConfigOpen, chartContainerRef, periodStart, periodEnd]);

  const SERIES_CONFIG = {
    ttwror: {
      name: ttwrorMode === 'cumulative' ? t('chart.entirePortfolio') : `${t('chart.entirePortfolio')} (${t('chart.annualizedPa')})`,
      color: dividend,
      yAxisId: 'ttwror',
    },
  } as const;

  const chartData = useMemo(
    () =>
      (chart ?? []).map((p) => ({
        date: p.date,
        ttwror: parseFloat(p.ttwrorCumulative),
      })),
    [chart],
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

  const mergedData = useMemo(() => {
    // Start with portfolio MV + TTWROR data (existing displayData)
    const dateMap = new Map<string, Record<string, number>>();

    for (const p of displayData) {
      dateMap.set(p.date, { ttwror: p.ttwror });
    }

    const periodStartDate = parseISO(periodStart);

    // Overlay each additional series
    for (const rs of chartSeries) {
      if (!rs.config.visible || rs.data.length === 0) continue;
      // Skip the default portfolio series — already shown via displayData's ttwror
      if (rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default') continue;

      const key = `series_${rs.config.id}`;
      for (const point of rs.data) {
        const existing = dateMap.get(point.date);
        if (existing) {
          let value = point.value;
          // Apply p.a. conversion to all series when in annualized mode
          if (ttwrorMode === 'annualized') {
            value = computeTtwrorPa(value, differenceInDays(parseISO(point.date), periodStartDate));
          }
          existing[key] = value;
        }
      }
    }

    // Overlay periodic bar returns — snap each periodic entry to the nearest chart date
    // because the chart is sampled (e.g. monthly) while periodic dates are period-ends
    if (periodicData && periodicBarsConfig?.visible) {
      const chartDates = Array.from(dateMap.keys()).sort();
      for (const pr of periodicData) {
        const prTime = new Date(pr.date).getTime();
        let bestDate: string | null = null;
        let bestDist = Infinity;
        for (const cd of chartDates) {
          const dist = Math.abs(new Date(cd).getTime() - prTime); // native-ok
          if (dist < bestDist) {
            bestDist = dist;
            bestDate = cd;
          }
        }
        if (bestDate) {
          const values = dateMap.get(bestDate)!;
          // Only assign if this chart date doesn't already have a periodic value,
          // or this periodic entry is closer than the previous one
          (values as Record<string, number | null>).periodicReturn = pr.value;
        }
      }
    }

    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [displayData, chartSeries, periodicData, periodicBarsConfig, ttwrorMode, periodStart]);

  // Auto-scale periodic bars so they're visible against the cumulative line
  const { scaledData, barScaleFactor } = useMemo(() => {
    if (!periodicBarsConfig?.visible || !periodicData?.length) {
      return { scaledData: mergedData, barScaleFactor: 1 };
    }

    const maxCum = Math.max(...mergedData.map((d) => Math.abs((d as Record<string, number>).ttwror ?? 0)), 0.001);
    const maxBar = Math.max(...periodicData.map((d) => Math.abs(d.value)), 0.001);
    const factor = maxCum > 3 * maxBar ? maxCum / (3 * maxBar) : 1; // native-ok

    if (factor <= 1.5) {
      return { scaledData: mergedData, barScaleFactor: 1 };
    }

    const scaled = mergedData.map((d) => {
      const raw = (d as Record<string, number | null>).periodicReturn;
      if (raw == null) return d;
      return { ...d, periodicReturn: raw * factor };
    });
    return { scaledData: scaled, barScaleFactor: factor };
  }, [mergedData, periodicBarsConfig, periodicData]);

  const barSize = useMemo(() => {
    if (!barInterval) return 6; // native-ok
    const sizes: Record<BarInterval, number> = {
      daily: 1, weekly: 3, monthly: 10, quarterly: 24, yearly: 48,
    };
    return sizes[barInterval];
  }, [barInterval]);

  const positiveBarColor = periodicBarsConfig?.positiveColor ?? 'var(--qv-positive)';
  const negativeBarColor = periodicBarsConfig?.negativeColor ?? 'var(--qv-negative)';

  // Build series name map for tooltip
  const seriesNameMap = useMemo(() => {
    const map = new Map<string, { label: string; color: string; dashed: boolean }>();
    for (const rs of chartSeries) {
      if (rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default') continue;
      const sec = rs.config.securityId
        ? securities?.find((s) => s.id === rs.config.securityId)
        : null;
      let label = rs.config.label ?? '';
      if (!label) {
        switch (rs.config.type) {
          case 'portfolio': label = t('chart.entirePortfolio'); break;
          case 'security': label = sec?.name ?? 'Security'; break;
          case 'benchmark': label = sec?.name ? `${sec.name} (B)` : 'Benchmark'; break;
          case 'account': label = 'Account'; break;
        }
      }
      map.set(`series_${rs.config.id}`, {
        label,
        color: rs.config.color ?? palette[0],
        dashed: rs.config.lineStyle !== 'solid',
      });
    }
    return map;
  }, [chartSeries, securities, t, palette]);

  // Legend items
  const legendItems: LegendItem[] = useMemo(() => {
    const items: LegendItem[] = [
      { kind: 'static', key: 'ttwror', color: SERIES_CONFIG.ttwror.color, label: SERIES_CONFIG.ttwror.name, indicator: 'line' },
    ];

    const sortedSeries = [...chartSeries]
      .filter((rs) => rs.config.visible && (rs.data.length > 0 || rs.config.type === 'periodic_bars'))
      .filter((rs) => !(rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default'))
      .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0));

    for (const rs of sortedSeries) {
      if (rs.config.type === 'periodic_bars') {
        const intervalKey = rs.config.barInterval ?? 'monthly';
        const intervalLabel = t(`chart.interval${intervalKey.charAt(0).toUpperCase() + intervalKey.slice(1)}` as 'chart.intervalMonthly');
        items.push({
          kind: 'interactive',
          id: rs.config.id,
          color: rs.config.positiveColor ?? 'var(--qv-positive)',
          label: `${intervalLabel} ${t('chart.performanceLabel')}${barScaleFactor > 1 ? ` ${t('chart.scaled')}` : ''}`,
          lineStyle: rs.config.lineStyle ?? 'solid',
          seriesType: 'bar',
          areaFill: false,
        });
      } else {
        const info = seriesNameMap.get(`series_${rs.config.id}`);
        if (!info) continue;
        items.push({
          kind: 'interactive',
          id: rs.config.id,
          color: info.color,
          label: info.label,
          lineStyle: rs.config.lineStyle ?? 'solid',
          seriesType: 'line',
          areaFill: rs.config.areaFill ?? false,
        });
      }
    }

    return items;
  }, [SERIES_CONFIG, chartSeries, seriesNameMap, barScaleFactor, t, palette]);

  return (
    <Card style={{ animation: 'qv-stagger-in 0.5s ease-out both', animationDelay: '120ms' }}>
        <CardHeader>
          <CardTitle className="text-base">{t('chart.entirePortfolio')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChartSkeleton height={360} />
          ) : (
            <FadeIn>
            <div ref={chartContainerRef} className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity duration-200')} style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={scaledData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  {chartSeries
                    .filter((rs) => rs.config.areaFill && rs.config.visible)
                    .map((rs) => {
                      const fillId = `areaFill-${rs.config.id.replace(/[^a-zA-Z0-9]/g, '')}`;
                      const color = rs.config.color ?? palette[0];
                      return (
                        <linearGradient key={fillId} id={fillId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                        </linearGradient>
                      );
                    })}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={gridOpacity} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: tickColor, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  ticks={ticks}
                  tickFormatter={tickFormatter}
                />
                <YAxis
                  yAxisId={SERIES_CONFIG.ttwror.yAxisId}
                  orientation="left"
                  tick={{ fill: tickColor, fontSize: 11, style: { fontFeatureSettings: '"tnum"' } }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tickFormatter={(v: number) => formatPercentage(v)}
                />
                <Tooltip
                  cursor={{ stroke: cursorColor, strokeDasharray: cursorDasharray }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <ChartTooltip label={formatDate(label as string)}>
                        {payload.map((entry) => {
                          const key = entry.dataKey as string;
                          const val = entry.value;
                          if (val == null || typeof val !== 'number' || Number.isNaN(val)) return null;
                          if (key === 'ttwror') {
                            return (
                              <ChartTooltipRow
                                key={key}
                                color={SERIES_CONFIG.ttwror.color}
                                label={SERIES_CONFIG.ttwror.name}
                                value={formatPercentage(val)}
                              />
                            );
                          } else if (key.startsWith('series_')) {
                            const info = seriesNameMap.get(key);
                            if (!info) return null;
                            return (
                              <ChartTooltipRow
                                key={key}
                                color={info.color}
                                label={info.label}
                                value={formatPercentage(val)}
                                dashed={info.dashed}
                              />
                            );
                          } else if (key === 'periodicReturn') {
                            if (val == null || typeof val !== 'number' || Number.isNaN(val)) return null;
                            const realVal = barScaleFactor > 1 ? val / barScaleFactor : val;
                            const intervalKey = barInterval ?? 'monthly';
                            const intervalLabel = t(`chart.interval${intervalKey.charAt(0).toUpperCase() + intervalKey.slice(1)}` as 'chart.intervalMonthly');
                            return (
                              <ChartTooltipRow
                                key={key}
                                color={realVal >= 0 ? positiveBarColor : negativeBarColor}
                                label={`${intervalLabel} ${t('chart.returnLabel')}`}
                                value={formatPercentage(realVal)}
                              />
                            );
                          }
                          return null;
                        })}
                      </ChartTooltip>
                    );
                  }}
                />
                {periodicBarsConfig?.visible && periodicData && periodicData.length > 0 && (
                  <Bar
                    yAxisId={SERIES_CONFIG.ttwror.yAxisId}
                    dataKey="periodicReturn"
                    barSize={barSize}
                    opacity={0.45}
                    isAnimationActive={false}
                  >
                    {scaledData.map((entry, index) => {
                      const val = (entry as Record<string, number | null>).periodicReturn;
                      return (
                        <Cell
                          key={index}
                          fill={val != null && val >= 0 ? positiveBarColor : negativeBarColor}
                        />
                      );
                    })}
                  </Bar>
                )}
                <Line
                  key={ttwrorMode}
                  yAxisId={SERIES_CONFIG.ttwror.yAxisId}
                  type="monotone"
                  dataKey="ttwror"
                  stroke={SERIES_CONFIG.ttwror.color}
                  strokeWidth={2}
                  dot={false}
                  name={SERIES_CONFIG.ttwror.name}
                  animationDuration={800}
                  animationEasing="ease-out"
                />
                {chartSeries
                  .filter((rs) => rs.config.visible && rs.data.length > 0)
                  .filter((rs) => !(rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default'))
                  .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0))
                  .filter((rs) => {
                    if (isolatedSeries) return rs.config.id === isolatedSeries;
                    return !hiddenSeries.has(rs.config.id);
                  })
                  .map((rs) => {
                    const seriesKey = `series_${rs.config.id}`;
                    const stroke = rs.config.color ?? palette[0];

                    if (rs.config.areaFill) {
                      const fillId = `areaFill-${rs.config.id.replace(/[^a-zA-Z0-9]/g, '')}`;
                      return (
                        <Area
                          key={rs.config.id}
                          yAxisId="ttwror"
                          type="monotone"
                          dataKey={seriesKey}
                          stroke={stroke}
                          strokeWidth={1.5}
                          strokeDasharray={getStrokeDasharray(rs.config.lineStyle)}
                          fill={`url(#${fillId})`}
                          dot={false}
                          connectNulls
                          animationDuration={800}
                          animationEasing="ease-out"
                        />
                      );
                    }

                    return (
                      <Line
                        key={rs.config.id}
                        yAxisId="ttwror"
                        type="monotone"
                        dataKey={seriesKey}
                        stroke={stroke}
                        strokeWidth={1.5}
                        strokeDasharray={getStrokeDasharray(rs.config.lineStyle)}
                        dot={false}
                        connectNulls
                        animationDuration={800}
                        animationEasing="ease-out"
                      />
                    );
                  })}
              </ComposedChart>
            </ResponsiveContainer>
            <InteractiveChartLegend
              items={legendItems}
              hiddenIds={hiddenSeries}
              isolatedId={isolatedSeries}
              onToggleVisibility={toggleSeriesVisibility}
              onIsolate={isolateSeries}
              onColorChange={handleColorChange}
              onLineStyleChange={handleLineStyleChange}
              onAreaFillToggle={handleAreaFillToggle}
              onRemove={handleRemoveSeries}
              onReorder={handleReorder}
            />
            </div>
            </FadeIn>
          )}
        </CardContent>
        <DataSeriesPickerDialog open={configOpen} onOpenChange={setConfigOpen} />
    </Card>
  );
}
