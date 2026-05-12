import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavTitle } from '@/hooks/useNavTitle';
import { differenceInDays, parseISO } from 'date-fns';
import {
  LineSeries, BaselineSeries,
  LineStyle as LwcLineStyle,
  PriceScaleMode,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
import { Button } from '@/components/ui/button';
import { usePerformanceChart, useReportingPeriod, useCalculation } from '@/api/use-performance';
import { ChartSummaryBar } from '@/components/domain/ChartSummaryBar';
import { useChartSeries } from '@/api/use-chart-series';
import { useSecurities } from '@/api/use-securities';
import { formatPercentage, computeTtwrorPa } from '@/lib/formatters';
import type { LineStyle, SeriesRole } from '@quovibe/shared';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useLightweightChart } from '@/hooks/use-lightweight-chart';
import { ChartExportButton } from '@/components/shared/ChartExportButton';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import {
  ExtendedChartLegendOverlay,
  type ExtendedLegendSeriesItem,
} from '@/components/shared/ChartLegendOverlay';
import { useAnalyticsContext } from '@/context/analytics-context';
import { ChartSeriesSheet } from '@/components/domain/analytics/ChartSeriesSheet';
import { cn } from '@/lib/utils';
import { useChartConfig, useSaveChartConfig } from '@/api/use-chart-config';
import { SegmentedControl } from '@/components/shared/SegmentedControl';

import { buildSeriesOptions } from '@/lib/chart-series-factory';
import { resolveAxis } from './chart-helpers/resolve-axis';

const PERCENT_FORMAT = {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

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
  useNavTitle('chart');
  const { periodStart, periodEnd } = useReportingPeriod();
  const { data: chart, isLoading, isFetching } = usePerformanceChart({ periodStart, periodEnd });
  const { data: calcData, isLoading: calcLoading } = useCalculation();
  const { isPrivate } = usePrivacy();
  const { dividend, palette, loss } = useChartColors();

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

    // Apply directly to the LWC series for immediate feedback.
    // areaFill === true → Baseline series with profit/loss zones; a single hex
    // can't be hot-swapped into topFillColor1/bottomFillColor2/etc. without
    // duplicating factory logic here. The persistSeriesUpdate above triggers
    // the rebuild effect, which picks up the new color via the factory.
    const entry = seriesMapRef.current.get(id);
    if (!entry) return;
    const cfg = chartConfig?.series.find((s) => s.id === id);
    if (cfg?.areaFill) return;
    entry.series.applyOptions({ color } as Record<string, unknown>);
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
    setLegendTrigger((v) => v + 1); // native-ok
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

  const { setActions, setSubtitle } = useAnalyticsContext();

  const [ttwrorMode, setTtwrorMode] = useState<'cumulative' | 'annualized'>('cumulative');

  useEffect(() => {
    setSubtitle(t('chart.subtitle'));
    return () => { setSubtitle(''); setActions(null); };
  }, [t, setSubtitle, setActions]);

  useEffect(() => {
    setActions(
      <>
        <SegmentedControl
          segments={[
            { value: 'cumulative', label: t('chart.cumulative') },
            { value: 'annualized', label: t('chart.annualized') },
          ]}
          value={ttwrorMode}
          onChange={setTtwrorMode}
        />
        <ChartExportButton
          chartRef={chartContainerRef}
          filename={`performance-chart-${periodStart}-to-${periodEnd}`}
        />
        <Button
          variant="default"
          size="sm"
          className="h-8"
          onClick={() => setConfigOpen(true)}
        >
          {t('chart.action.compare')}
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

  // Derive summary bar data
  const totalReturn = displayData.length > 0
    ? displayData[displayData.length - 1].ttwror // native-ok
    : 0;
  const absoluteGain = calcData ? parseFloat(calcData.absolutePerformance) : 0;

  // --- Lightweight Charts setup ---

  const { containerRef, chartRef, ready } = useLightweightChart({
    options: {
      rightPriceScale: { visible: true },
      leftPriceScale: { visible: true },
    },
  });

  // Track all active series by config ID
  interface SeriesEntry {
    series: ISeriesApi<SeriesType>;
    visible: boolean;
  }
  const seriesMapRef = useRef<Map<string, SeriesEntry>>(new Map());
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
    } catch {
      seriesMapRef.current.clear();
      return;
    }

    const periodStartDate = parseISO(periodStart);

    // --- Portfolio default series (always first) ---
    const portfolioConfig = chartSeries.find(
      (rs) => rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default',
    );
    const userPortfolio = chartSeries.find(
      (rs) => rs.config.type === 'portfolio' && rs.config.id !== 'portfolio-default',
    );

    // Suppress the fallback stub when the user has explicitly added their own
    // portfolio series — otherwise both render and the legend duplicates.
    if (!userPortfolio) {
      const portfolioAreaFill = portfolioConfig?.config.areaFill ?? false;
      const portfolioLineStyle = portfolioConfig?.config.lineStyle ?? 'solid';
      const portfolioColor = portfolioConfig?.config.color ?? dividend;
      const portfolioVisible = portfolioConfig?.config.visible ?? true;

      const portfolioData = displayData
        .map((p) => ({ time: p.date, value: p.ttwror }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)); // native-ok

      const portfolioType = portfolioAreaFill ? 'baseline' as const : 'line' as const;
      const { options: portfolioOptions } = buildSeriesOptions(portfolioType, {
        color: portfolioColor,
        profitColor: portfolioColor,
        lossColor: loss,
        basePrice: 0,
        lineStyle: toLwcLineStyle(portfolioLineStyle),
        priceScaleId: 'left',
        visible: portfolioVisible,
        seriesRole: 'portfolio',
      });
      const PortfolioConstructor = portfolioAreaFill ? BaselineSeries : LineSeries;
      const portfolioSeries = chart.addSeries(PortfolioConstructor, portfolioOptions);
      portfolioSeries.setData(portfolioData);
      seriesMapRef.current.set('portfolio-default', {
        series: portfolioSeries,
        visible: portfolioVisible,
      });
    }

    // --- Additional series (securities, benchmarks, accounts, additional portfolios) ---
    // Resolve portfolio reference for axis assignment (portfolioConfig already found above)
    const portfolioRef = chartSeries.find((rs) => rs.config.id === 'portfolio-default');

    const sortedSeries = [...chartSeries]
      .filter((rs) => !(rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default'))
      .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0));

    for (const rs of sortedSeries) {
      if (rs.data.length === 0) continue; // native-ok — empty series renders in legend only, no chart line

      const color = rs.config.color ?? palette[0];
      const lineStyle = toLwcLineStyle(rs.config.lineStyle);
      const isVisible = rs.config.visible;
      const axis = portfolioRef ? resolveAxis(rs, portfolioRef) : 'left';

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

      const role: SeriesRole =
        (rs.config as { role?: SeriesRole }).role
        ?? (rs.config.type === 'portfolio' ? 'portfolio'
           : rs.config.type === 'benchmark' ? 'reference'
           : 'holding');

      const rsType = rs.config.areaFill ? 'baseline' as const : 'line' as const;
      const { options: rsOptions } = buildSeriesOptions(rsType, {
        color,
        profitColor: color,
        lossColor: loss,
        basePrice: 0,
        lineStyle,
        priceScaleId: axis,
        visible: isVisible,
        seriesRole: role,
      });
      const RsConstructor = rs.config.areaFill ? BaselineSeries : LineSeries;
      const lwcSeries = chart.addSeries(RsConstructor, rsOptions);
      lwcSeries.setData(seriesData);
      seriesMapRef.current.set(rs.config.id, { series: lwcSeries, visible: isVisible });
    }

    // Format both price scales as percentage (TTWROR values are fractions)
    chart.priceScale('right').applyOptions({ mode: PriceScaleMode.Normal });
    chart.priceScale('left').applyOptions({ mode: PriceScaleMode.Normal });

    // Apply percentage formatter to every series so each axis inherits correct labels.
    // lightweight-charts derives axis labels from the price format of each series on that scale.
    for (const [, entry] of seriesMapRef.current) {
      entry.series.applyOptions({
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => formatPercentage(price),
        },
      } as Record<string, unknown>);
    }

    chart.timeScale().fitContent();
    setLegendTrigger((v) => v + 1); // native-ok — seriesMapRef is a ref, must trigger re-render for legend

  }, [displayData, chartSeries, ttwrorMode, periodStart, dividend, loss, palette[0], ready]);

  // --- Build legend items for ExtendedChartLegendOverlay ---

  const legendItems: ExtendedLegendSeriesItem[] = useMemo(() => {
    if (!ready || seriesMapRef.current.size === 0) return [];

    const items: ExtendedLegendSeriesItem[] = [];

    // Portfolio default series
    const portfolioEntry = seriesMapRef.current.get('portfolio-default');
    const portfolioConfig = chartConfig?.series.find((s) => s.id === 'portfolio-default');
    if (portfolioEntry) {
      const portfolioLabel = ttwrorMode === 'cumulative'
        ? t('chart.entirePortfolio')
        : `${t('chart.entirePortfolio')} (${t('chart.annualizedPa')})`;

      // Period-end last value for the portfolio (displayData already mode-adjusted)
      const portfolioLast = displayData.at(-1)?.ttwror ?? null;

      items.push({
        id: 'portfolio-default',
        label: portfolioLabel,
        color: portfolioConfig?.color ?? dividend,
        series: portfolioEntry.series,
        visible: portfolioEntry.visible,
        formatValue: formatPercentage,
        numberFormat: PERCENT_FORMAT,
        lineStyle: portfolioConfig?.lineStyle ?? 'solid',
        areaFill: portfolioConfig?.areaFill ?? false,
        locked: true,
        status: 'ok',
        lastValue: portfolioLast,
        deltaVsPortfolio: null,
      });
    }

    // Portfolio last value for delta computation
    const portfolioLast = displayData.at(-1)?.ttwror ?? null;

    // Additional series (sorted by order)
    const sortedConfigs = [...chartSeries]
      .filter((rs) => rs.config.visible)
      .filter((rs) => !(rs.config.type === 'portfolio' && rs.config.id === 'portfolio-default'))
      .sort((a, b) => (a.config.order ?? 0) - (b.config.order ?? 0));

    for (const rs of sortedConfigs) {
      const entry = seriesMapRef.current.get(rs.config.id);

      const info = seriesNameMap.get(rs.config.id);
      if (!info) continue;

      // Compute mode-adjusted last value for this series
      const lastPoint = rs.data.at(-1);
      let lastValue: number | null = null;
      if (lastPoint) {
        if (ttwrorMode === 'cumulative') {
          lastValue = lastPoint.value;
        } else {
          lastValue = computeTtwrorPa(
            lastPoint.value,
            differenceInDays(parseISO(lastPoint.date), parseISO(periodStart)),
          );
        }
      }

      items.push({
        id: rs.config.id,
        label: info.label,
        color: info.color,
        series: entry?.series ?? null,
        visible: entry?.visible ?? rs.config.visible,
        formatValue: formatPercentage,
        numberFormat: PERCENT_FORMAT,
        lineStyle: rs.config.lineStyle ?? 'solid',
        areaFill: rs.config.areaFill ?? false,
        status: rs.status,
        lastValue,
        deltaVsPortfolio: (lastValue == null || portfolioLast == null)
          ? null
          : lastValue - portfolioLast, // native-ok — display delta
      });
    }

    return items;
  }, [legendTrigger, chartConfig, chartSeries, seriesNameMap, ttwrorMode, t, dividend, ready, displayData, periodStart]);

  return (
    <div className="space-y-3" style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '120ms' }}>
      {/* Summary bar */}
      <ChartSummaryBar
        totalReturn={totalReturn}
        absoluteGain={absoluteGain}
        periodStart={periodStart}
        periodEnd={periodEnd}
        isLoading={isLoading || calcLoading}
      />

      {/* Chart area — full width, no rail split */}
      <div className="relative" style={{ minHeight: 400 }}>
        {isLoading && <ChartSkeleton height={400} />}
        <div className={cn(isLoading && 'invisible')}>
          <div className="mb-1">
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
            <div ref={containerRef} className="w-full" style={{ height: 400 }} />
          </div>
        </div>
      </div>

      <ChartSeriesSheet open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
