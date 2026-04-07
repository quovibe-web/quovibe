import { useState, useRef, useEffect, useMemo } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChartToolbar } from '@/components/shared/ChartToolbar';
import { ChartLegendOverlay, type LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';
import { FadeIn } from '@/components/shared/FadeIn';

const CHART_ID = 'widget-perf';

export default function WidgetPerfChart() {
  const { t } = useTranslation('performance');
  const { t: tDash } = useTranslation('dashboard');
  const { isPrivate } = usePrivacy();
  const { profit, dividend } = useChartColors();

  const [ttwrorMode, setTtwrorMode] = useState<'cumulative' | 'annualized'>('cumulative');
  const [chartType, setChartType] = useState<ChartSeriesType>(
    () => getSavedChartType(CHART_ID) ?? 'area',
  );

  const { containerRef, chartRef } = useLightweightChart({
    options: {
      rightPriceScale: { visible: true },
      leftPriceScale: { visible: true },
    },
  });

  // Refs for both series
  const mvSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const ttwrorSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // Incremented after each series rebuild to trigger a re-render so legendItems picks up
  // the fresh refs (refs don't cause re-renders on their own).
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

  const displayData = useMemo(() => {
    if (ttwrorMode === 'cumulative') return chartData;
    const start = parseISO(periodStart);
    return chartData.map((p) => ({
      ...p,
      ttwror: computeTtwrorPa(p.ttwror, differenceInDays(parseISO(p.date), start)),
    }));
  }, [chartData, ttwrorMode, periodStart]);

  const mvData = useMemo(
    () =>
      displayData
        .map((p) => ({ time: p.date, value: p.marketValue }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)), // native-ok
    [displayData],
  );

  const ttwrorData = useMemo(
    () =>
      displayData
        .map((p) => ({ time: p.date, value: p.ttwror }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)), // native-ok
    [displayData],
  );

  // Create or recreate the MV series when chart type or colors change.
  // TTWROR series is always a line — recreate when colors or data change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !mvData.length) return;

    // Remove existing series
    if (mvSeriesRef.current) {
      chart.removeSeries(mvSeriesRef.current);
      mvSeriesRef.current = null;
    }
    if (ttwrorSeriesRef.current) {
      chart.removeSeries(ttwrorSeriesRef.current);
      ttwrorSeriesRef.current = null;
    }

    // Market Value series (right price scale) — type follows chartType
    let mvSeries: ISeriesApi<SeriesType>;
    switch (chartType) {
      case 'line':
        mvSeries = chart.addSeries(LineSeries, {
          color: profit,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          priceScaleId: 'right',
        });
        break;
      case 'baseline':
        mvSeries = chart.addSeries(BaselineSeries, {
          baseValue: { type: 'price', price: 0 },
          topLineColor: profit,
          topFillColor1: profit + '40',
          topFillColor2: 'transparent',
          bottomLineColor: profit,
          bottomFillColor1: 'transparent',
          bottomFillColor2: 'transparent',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          priceScaleId: 'right',
        });
        break;
      case 'histogram':
        mvSeries = chart.addSeries(HistogramSeries, {
          color: profit + 'b0',
          lastValueVisible: false,
          priceLineVisible: false,
          priceScaleId: 'right',
        });
        break;
      case 'area':
      default:
        mvSeries = chart.addSeries(AreaSeries, {
          lineColor: profit,
          topColor: profit + '40',
          bottomColor: 'transparent',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          priceScaleId: 'right',
        });
        break;
    }

    // TTWROR series (left price scale) — always a line
    const ttwrorSeries = chart.addSeries(LineSeries, {
      color: dividend,
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'left',
    });

    mvSeries.setData(mvData);
    ttwrorSeries.setData(ttwrorData);
    chart.timeScale().fitContent();

    mvSeriesRef.current = mvSeries;
    ttwrorSeriesRef.current = ttwrorSeries;
    setSeriesVersion((v) => v + 1); // native-ok — triggers re-render to refresh legendItems
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, profit, dividend, data, ttwrorMode]);

  const ttwrorLabel = ttwrorMode === 'cumulative' ? t('chart.ttwror') : t('chart.ttwrorPa');

  // Build legend items — depends on seriesVersion so it re-derives after every series rebuild
  const legendItems: LegendSeriesItem[] = seriesVersion > 0 && mvSeriesRef.current && ttwrorSeriesRef.current
    ? [
        {
          id: 'mv',
          label: t('chart.marketValue'),
          color: profit,
          series: mvSeriesRef.current,
          visible: true,
          formatValue: (v: number) => formatCurrency(v),
        },
        {
          id: 'ttwror',
          label: ttwrorLabel,
          color: dividend,
          series: ttwrorSeriesRef.current,
          visible: true,
          formatValue: (v: number) => formatPercentage(v),
        },
      ]
    : [];

  const handleTypeChange = (type: ChartSeriesType) => {
    setChartType(type);
  };

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

  return (
    <FadeIn>
      <div
        className={cn(
          'group/chart relative',
          isFetching && !isLoading && 'opacity-60 transition-opacity duration-200',
        )}
        style={{
          filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
          transition: 'filter 0.2s ease',
        }}
      >
        {/* Cumulative / Annualized toggle — sits above the chart container */}
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

        <div ref={containerRef} className="w-full" style={{ height: 250 }} />

        <ChartLegendOverlay
          chart={chartRef.current}
          items={legendItems}
        />
        <ChartToolbar
          chartId={CHART_ID}
          activeType={chartType}
          hasOhlc={false}
          onTypeChange={handleTypeChange}
        />
      </div>
    </FadeIn>
  );
}
