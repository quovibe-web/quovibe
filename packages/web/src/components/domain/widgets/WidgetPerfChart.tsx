import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  AreaSeries, LineSeries, BaselineSeries, HistogramSeries,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
import { useWidgetChartCalculation } from '@/hooks/use-widget-chart-calculation';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useLightweightChart } from '@/hooks/use-lightweight-chart';
import { differenceInDays, parseISO } from 'date-fns';
import { formatPercentage, formatCurrency, computeTtwrorPa } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { getSavedChartType, type ChartSeriesType } from '@/lib/chart-types';
import { buildSeriesOptions } from '@/lib/chart-series-factory';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChartToolbar } from '@/components/shared/ChartToolbar';
import { ChartLegendOverlay, type LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';
import { useWidgetToolbarPortal } from '@/components/domain/WidgetShell';


const CHART_ID = 'widget-perf';

type MetricMode = 'mv' | 'ttwror' | 'ttwrorPa';

export default function WidgetPerfChart() {
  const { t } = useTranslation('performance');
  const { t: tDash } = useTranslation('dashboard');
  const { isPrivate } = usePrivacy();
  const { profit, loss } = useChartColors();
  const toolbarTarget = useWidgetToolbarPortal();

  const [metric, setMetric] = useState<MetricMode>('mv');
  const [chartType, setChartType] = useState<ChartSeriesType>(
    () => getSavedChartType(CHART_ID) ?? 'baseline',
  );

  const isPercentage = metric !== 'mv';

  const { containerRef, chartRef, ready } = useLightweightChart({
    options: {
      rightPriceScale: { visible: true },
      leftPriceScale: { visible: false },
    },
  });

  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const [seriesVersion, setSeriesVersion] = useState(0);

  const { data, isLoading, isError, error, isFetching, periodStart } = useWidgetChartCalculation();

  const chartData = useMemo(
    () =>
      (data ?? []).map((p) => ({
        date: p.date as string,
        marketValue: parseFloat(p.marketValue),
        ttwror: parseFloat(p.ttwrorCumulative),
      })),
    [data],
  );

  const seriesData = useMemo(() => {
    if (metric === 'mv') {
      return chartData
        .map((p) => ({ time: p.date, value: p.marketValue }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)); // native-ok
    }
    const start = parseISO(periodStart);
    return chartData
      .map((p) => ({
        time: p.date,
        value: metric === 'ttwrorPa'
          ? computeTtwrorPa(p.ttwror, differenceInDays(parseISO(p.date), start))
          : p.ttwror,
      }))
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)); // native-ok
  }, [chartData, metric, periodStart]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || !seriesData.length) return;

    try {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
    } catch { seriesRef.current = null; return; }

    const SERIES_MAP = {
      Line: LineSeries, Area: AreaSeries, Baseline: BaselineSeries, Histogram: HistogramSeries,
    } as const;

    const basePrice = isPercentage ? 0 : (seriesData.length > 0 ? seriesData[0].value : 0); // native-ok
    const { seriesType, options } = buildSeriesOptions(chartType, {
      color: profit,
      basePrice,
      profitColor: profit,
      lossColor: loss,
      priceScaleId: 'right',
    });
    const Constructor = SERIES_MAP[seriesType as keyof typeof SERIES_MAP] ?? LineSeries;
    const series: ISeriesApi<SeriesType> = chart.addSeries(Constructor, options);

    if (isPercentage) {
      series.applyOptions({
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => `${(price * 100).toFixed(2)}%`, // native-ok
        },
      } as Record<string, unknown>);
    }

    series.setData(seriesData);
    chart.timeScale().fitContent();
    seriesRef.current = series;
    setSeriesVersion((v) => v + 1); // native-ok
  }, [chartType, profit, loss, metric, data, ready]);

  const metricLabel = metric === 'mv'
    ? t('chart.marketValue')
    : metric === 'ttwror'
      ? t('chart.ttwror')
      : t('chart.ttwrorPa');

  const legendItems: LegendSeriesItem[] = seriesVersion > 0 && seriesRef.current
    ? [
        {
          id: 'main',
          label: metricLabel,
          color: profit,
          series: seriesRef.current,
          visible: true,
          formatValue: isPercentage
            ? (v: number) => formatPercentage(v)
            : (v: number) => formatCurrency(v),
        },
      ]
    : [];

  const handleTypeChange = (type: ChartSeriesType) => {
    setChartType(type);
  };

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  const toolbarElement = (
    <>
      {/* Metric toggle: MV / Cumulative / p.a. */}
      <div className="inline-flex rounded-full border border-border bg-muted/50 p-0.5">
        <button
          className={cn(
            'px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            metric === 'mv'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setMetric('mv')}
        >
          MV
        </button>
        <button
          className={cn(
            'px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            metric === 'ttwror'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setMetric('ttwror')}
        >
          {t('chart.cumulative')}
        </button>
        <button
          className={cn(
            'px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            metric === 'ttwrorPa'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setMetric('ttwrorPa')}
        >
          {t('chart.annualizedPa')}
        </button>
      </div>
      <ChartToolbar
        chartId={CHART_ID}
        activeType={chartType}
        hasOhlc={false}
        onTypeChange={handleTypeChange}
      />
    </>
  );

  return (
    <div className="flex flex-col" style={{ height: 280 }}>
      {toolbarTarget && createPortal(toolbarElement, toolbarTarget)}
      {isLoading && <Skeleton className="absolute inset-0 rounded-lg z-20" />}
      {!isLoading && !chartData.length && (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          {tDash('noChartData')}
        </div>
      )}
      <div className="flex items-center shrink-0 mb-1">
        <ChartLegendOverlay
          chart={chartRef.current}
          items={legendItems}
        />
        {!toolbarTarget && toolbarElement}
      </div>
      <div
        className={cn(
          'relative flex-1 min-h-0',
          isLoading && 'invisible',
          isFetching && !isLoading && 'opacity-60 transition-opacity duration-200',
        )}
        style={{
          filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
          transition: 'filter 0.2s ease',
        }}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
