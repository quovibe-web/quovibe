import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { differenceInDays, parseISO } from 'date-fns';
import { Settings } from 'lucide-react';
import {
  LineSeries, AreaSeries, HistogramSeries,
  LineStyle as LwcLineStyle,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
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
import { useLightweightChart } from '@/hooks/use-lightweight-chart';
import { ChartExportButton } from '@/components/shared/ChartExportButton';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import {
  ExtendedChartLegendOverlay,
  type ExtendedLegendSeriesItem,
} from '@/components/shared/ChartLegendOverlay';
import { FadeIn } from '@/components/shared/FadeIn';
import { useAnalyticsContext } from '@/context/analytics-context';
import { DataSeriesPickerDialog } from '@/components/domain/DataSeriesPickerDialog';
import { cn } from '@/lib/utils';
import { useChartConfig, useSaveChartConfig } from '@/api/use-chart-config';
import { getColor } from '@/lib/colors';
import { withAlpha } from '@/lib/chart-types';

/** Map shared LineStyle string to lightweight-charts LineStyle enum */
function toLwcLineStyle(style: LineStyle): LwcLineStyle {
  switch (style) {
    case 'dashed': return LwcLineStyle.Dashed;
    case 'dotted': return LwcLineStyle.Dotted;
    default: return LwcLineStyle.Solid;
  }
}

export default function PerformanceChart() {
  const { t } = useTranslation('performance');
  const { periodStart, periodEnd } = useReportingPeriod();
  const { data: chart, isLoading, isFetching } = usePerformanceChart({ periodStart, periodEnd });
  const { isPrivate } = usePrivacy();
  const { dividend, palette } = useChartColors();

  const [configOpen, setConfigOpen] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const { data: chartConfig } = useChartConfig();
  const saveChartConfig = useSaveChartConfig();

  // --- Config persistence helpers ---

  function persistSeriesUpdate(id: string, patch: Record<string, unknown>) {
    if (!chartConfig) return;
    const updatedSeries = chartConfig.series.map((s) =>
      s.id === id ? { ...s, ...patch } : s,
    );
    saveChartConfig.mutate({ ...chartConfig, series: updatedSeries });
  }

  function handleColorChange(id: string, color: string) {
    persistSeriesUpdate(id, { color });

    // Apply directly to the LWC series for immediate feedback
    const entry = seriesMapRef.current.get(id);
    if (!entry) return;
    const cfg = chartConfig?.series.find((s) => s.id === id);
    if (cfg?.areaFill) {
      entry.series.applyOptions({
        lineColor: color,
        topColor: withAlpha(color, 0.25),
        bottomColor: 'transparent',
      } as Record<string, unknown>);
    } else {
      entry.series.applyOptions({ color } as Record<string, unknown>);
    }
  }

  function handleLineStyleChange(id: string, style: LineStyle) {
    persistSeriesUpdate(id, { lineStyle: style });

    // Apply directly
    const entry = seriesMapRef.current.get(id);
    if (entry) {
      entry.series.applyOptions({ lineStyle: toLwcLineStyle(style) } as Record<string, unknown>);
    }
  }

  function handleAreaFillToggle(id: string) {
    const series = chartConfig?.series.find((s) => s.id === id);
    if (!series) return;
    persistSeriesUpdate(id, { areaFill: !series.areaFill });
    // Series will be rebuilt on next config/data change via the effect
  }

  function handleToggleVisibility(id: string) {
    const entry = seriesMapRef.current.get(id);
    if (!entry) return;

    const newVisible = !entry.visible;
    entry.visible = newVisible;
    entry.series.applyOptions({ visible: newVisible });

    // Also update config persistence
    persistSeriesUpdate(id, { visible: newVisible });
  }

  function handleIsolate(id: string) {
    // Toggle: if already isolated (all others hidden), restore all; otherwise hide all except id
    const entries = Array.from(seriesMapRef.current.entries());
    const isAlreadyIsolated = entries.every(
      ([key, e]) => key === id ? e.visible : !e.visible,
    );

    if (isAlreadyIsolated) {
      // Restore all
      for (const [, e] of entries) {
        e.visible = true;
        e.series.applyOptions({ visible: true });
      }
    } else {
      // Isolate: show only the target
      for (const [key, e] of entries) {
        const shouldShow = key === id;
        e.visible = shouldShow;
        e.series.applyOptions({ visible: shouldShow });
      }
    }

    // Force legend re-derivation
    seriesBuildCount.current += 1; // native-ok
    setLegendTrigger(seriesBuildCount.current);
  }

  function handleRemoveSeries(id: string) {
    if (!chartConfig) return;

    // Remove from LWC chart
    const chart = chartRef.current;
    const entry = seriesMapRef.current.get(id);
    if (chart && entry) {
      try { chart.removeSeries(entry.series); } catch { /* chart destroyed */ }
      seriesMapRef.current.delete(id);
    }

    // Remove from config
    const updatedSeries = chartConfig.series.filter((s) => s.id !== id);
    saveChartConfig.mutate({ ...chartConfig, series: updatedSeries });
  }

  function handleReorder(orderedIds: string[]) {
    if (!chartConfig) return;
    const updatedSeries = chartConfig.series.map((s) => {
      const idx = orderedIds.indexOf(s.id); // native-ok
      return idx >= 0 ? { ...s, order: idx } : s;
    });
    saveChartConfig.mutate({ ...chartConfig, series: updatedSeries });
    // Series z-order will be rebuilt in the next effect cycle
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

  // --- Portfolio TTWROR base data ---

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

  // --- Lightweight Charts setup ---

  const { containerRef, chartRef, ready } = useLightweightChart({
    options: {
      rightPriceScale: { visible: true },
      leftPriceScale: { visible: false },
    },
  });

  // Track all active series by config ID
  interface SeriesEntry {
    series: ISeriesApi<SeriesType>;
    visible: boolean;
  }
  const seriesMapRef = useRef<Map<string, SeriesEntry>>(new Map());
  const barSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // Counter incremented after each series rebuild — used as useMemo dep to re-derive legend items.
  // This is a ref+state pair: ref tracks the value, forceUpdate triggers re-render.
  const seriesBuildCount = useRef(0);
  const [legendTrigger, setLegendTrigger] = useState(0);

  // --- Build series name map for legend ---

  const seriesNameMap = useMemo(() => {
    const map = new Map<string, { label: string; color: string }>();
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
      map.set(rs.config.id, {
        label,
        color: rs.config.color ?? palette[0],
      });
    }
    return map;
  }, [chartSeries, securities, t, palette]);

  // --- Main effect: create/rebuild all LWC series ---

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || displayData.length === 0) return; // native-ok

    // Remove all existing series (guard: chart may be destroyed during unmount)
    try {
      for (const [, entry] of seriesMapRef.current) {
        chart.removeSeries(entry.series);
      }
      seriesMapRef.current.clear();

      if (barSeriesRef.current) {
        chart.removeSeries(barSeriesRef.current);
        barSeriesRef.current = null;
      }
    } catch {
      seriesMapRef.current.clear();
      barSeriesRef.current = null;
      return;
    }

    const periodStartDate = parseISO(periodStart);

    // --- Portfolio default series (always first) ---
    const portfolioConfig = chartSeries.find(
      (rs) => rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default',
    );
    const portfolioAreaFill = portfolioConfig?.config.areaFill ?? false;
    const portfolioLineStyle = portfolioConfig?.config.lineStyle ?? 'solid';
    const portfolioColor = portfolioConfig?.config.color ?? dividend;
    const portfolioVisible = portfolioConfig?.config.visible ?? true;

    const portfolioData = displayData
      .map((p) => ({ time: p.date, value: p.ttwror }))
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)); // native-ok

    let portfolioSeries: ISeriesApi<SeriesType>;
    if (portfolioAreaFill) {
      portfolioSeries = chart.addSeries(AreaSeries, {
        lineColor: portfolioColor,
        topColor: withAlpha(portfolioColor, 0.25),
        bottomColor: 'transparent',
        lineWidth: 2,
        lineStyle: toLwcLineStyle(portfolioLineStyle),
        lastValueVisible: false,
        priceLineVisible: false,
        priceScaleId: 'right',
        visible: portfolioVisible,
      });
    } else {
      portfolioSeries = chart.addSeries(LineSeries, {
        color: portfolioColor,
        lineWidth: 2,
        lineStyle: toLwcLineStyle(portfolioLineStyle),
        lastValueVisible: false,
        priceLineVisible: false,
        priceScaleId: 'right',
        visible: portfolioVisible,
      });
    }
    portfolioSeries.setData(portfolioData);
    seriesMapRef.current.set('portfolio-default', {
      series: portfolioSeries,
      visible: portfolioVisible,
    });

    // --- Additional series (securities, benchmarks, accounts, additional portfolios) ---
    const sortedSeries = [...chartSeries]
      .filter((rs) => !(rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default'))
      .filter((rs) => rs.config.type !== 'periodic_bars')
      .filter((rs) => rs.data.length > 0) // native-ok
      .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0));

    for (const rs of sortedSeries) {
      const color = rs.config.color ?? palette[0];
      const lineStyle = toLwcLineStyle(rs.config.lineStyle);
      const isVisible = rs.config.visible;

      // Build per-series data array, applying p.a. conversion when needed
      const seriesData = rs.data
        .map((point) => {
          let value = point.value;
          if (ttwrorMode === 'annualized') {
            value = computeTtwrorPa(value, differenceInDays(parseISO(point.date), periodStartDate));
          }
          return { time: point.date, value };
        })
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)); // native-ok

      let lwcSeries: ISeriesApi<SeriesType>;
      if (rs.config.areaFill) {
        lwcSeries = chart.addSeries(AreaSeries, {
          lineColor: color,
          topColor: withAlpha(color, 0.25),
          bottomColor: 'transparent',
          lineWidth: 2,
          lineStyle,
          lastValueVisible: false,
          priceLineVisible: false,
          priceScaleId: 'right',
          visible: isVisible,
        });
      } else {
        lwcSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          lineStyle,
          lastValueVisible: false,
          priceLineVisible: false,
          priceScaleId: 'right',
          visible: isVisible,
        });
      }
      lwcSeries.setData(seriesData);
      seriesMapRef.current.set(rs.config.id, { series: lwcSeries, visible: isVisible });
    }

    // --- Periodic bars (histogram in pane 1) ---
    if (periodicBarsConfig?.visible && periodicData && periodicData.length > 0) { // native-ok
      const positiveColor = periodicBarsConfig.positiveColor ?? getColor('profit');
      const negativeColor = periodicBarsConfig.negativeColor ?? getColor('loss');

      const barData = periodicData
        .map((pr) => ({
          time: pr.date,
          value: pr.value,
          color: pr.value >= 0 ? positiveColor : negativeColor,
        }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)); // native-ok

      const barSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'bars',
        lastValueVisible: false,
        priceLineVisible: false,
      }, 1);

      barSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.05 },
      });

      barSeries.setData(barData);
      barSeriesRef.current = barSeries;

      // Also track in seriesMap for the legend crosshair
      seriesMapRef.current.set(periodicBarsConfig.id, {
        series: barSeries,
        visible: true,
      });
    }

    // Format right price scale as percentage (TTWROR values are fractions)
    chart.priceScale('right').applyOptions({
      mode: 0,
    });
    // Apply percentage formatter to the portfolio series (drives right scale labels)
    const portfolioEntry = seriesMapRef.current.get('portfolio-default');
    if (portfolioEntry) {
      portfolioEntry.series.applyOptions({
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => `${(price * 100).toFixed(2)}%`, // native-ok
        },
      } as Record<string, unknown>);
    }

    chart.timeScale().fitContent();
    seriesBuildCount.current += 1; // native-ok
    // Schedule legend re-derivation on next microtask to avoid setState-during-render
    Promise.resolve().then(() => setLegendTrigger(seriesBuildCount.current));

  }, [displayData, chartSeries, periodicData, periodicBarsConfig, ttwrorMode, periodStart, dividend, palette[0], ready]);

  // --- Build legend items for ExtendedChartLegendOverlay ---

  const legendItems: ExtendedLegendSeriesItem[] = useMemo(() => {
    if (legendTrigger === 0) return [];

    const items: ExtendedLegendSeriesItem[] = [];

    // Portfolio default series
    const portfolioEntry = seriesMapRef.current.get('portfolio-default');
    const portfolioConfig = chartConfig?.series.find((s) => s.id === 'portfolio-default');
    if (portfolioEntry) {
      const portfolioLabel = ttwrorMode === 'cumulative'
        ? t('chart.entirePortfolio')
        : `${t('chart.entirePortfolio')} (${t('chart.annualizedPa')})`;
      items.push({
        id: 'portfolio-default',
        label: portfolioLabel,
        color: portfolioConfig?.color ?? dividend,
        series: portfolioEntry.series,
        visible: portfolioEntry.visible,
        formatValue: (v: number) => formatPercentage(v),
        lineStyle: portfolioConfig?.lineStyle ?? 'solid',
        areaFill: portfolioConfig?.areaFill ?? false,
        locked: true,
      });
    }

    // Additional series (sorted by order)
    const sortedConfigs = [...chartSeries]
      .filter((rs) => rs.config.visible && (rs.data.length > 0 || rs.config.type === 'periodic_bars')) // native-ok
      .filter((rs) => !(rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default'))
      .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0));

    for (const rs of sortedConfigs) {
      const entry = seriesMapRef.current.get(rs.config.id);
      if (!entry) continue;

      if (rs.config.type === 'periodic_bars') {
        const intervalKey = rs.config.barInterval ?? 'monthly';
        const intervalLabel = t(`chart.interval${intervalKey.charAt(0).toUpperCase() + intervalKey.slice(1)}` as 'chart.intervalMonthly');
        items.push({
          id: rs.config.id,
          label: `${intervalLabel} ${t('chart.performanceLabel')}`,
          color: rs.config.positiveColor ?? getColor('profit'),
          series: entry.series,
          visible: entry.visible,
          formatValue: (v: number) => formatPercentage(v),
          lineStyle: 'solid',
          areaFill: false,
        });
      } else {
        const info = seriesNameMap.get(rs.config.id);
        if (!info) continue;
        items.push({
          id: rs.config.id,
          label: info.label,
          color: info.color,
          series: entry.series,
          visible: entry.visible,
          formatValue: (v: number) => formatPercentage(v),
          lineStyle: rs.config.lineStyle ?? 'solid',
          areaFill: rs.config.areaFill ?? false,
        });
      }
    }

    return items;
  }, [legendTrigger, chartConfig, chartSeries, seriesNameMap, ttwrorMode, t, dividend, ready]);

  return (
    <Card style={{ animation: 'qv-stagger-in 0.5s ease-out both', animationDelay: '120ms' }}>
        <CardHeader>
          <CardTitle className="text-base">{t('chart.entirePortfolio')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative" style={{ minHeight: 360 }}>
            {isLoading && <ChartSkeleton height={360} />}
            <div className={cn(isLoading && 'invisible')}>
              <div className="flex items-center justify-between mb-1">
                <ExtendedChartLegendOverlay
                  chart={chartRef.current}
                  items={legendItems}
                  onToggleVisibility={handleToggleVisibility}
                  onColorChange={handleColorChange}
                  onLineStyleChange={handleLineStyleChange}
                  onAreaFillToggle={handleAreaFillToggle}
                  onRemove={handleRemoveSeries}
                  onReorder={handleReorder}
                  onIsolate={handleIsolate}
                />
              </div>
              <div
                ref={chartContainerRef}
                className={cn(
                  'relative',
                  isFetching && !isLoading && 'opacity-60 transition-opacity duration-200',
                )}
                style={{
                  filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
                  transition: 'filter 0.2s ease',
                }}
              >
                <div ref={containerRef} className="w-full" style={{ height: 360 }} />
              </div>
            </div>
          </div>
        </CardContent>
        <DataSeriesPickerDialog open={configOpen} onOpenChange={setConfigOpen} />
    </Card>
  );
}
