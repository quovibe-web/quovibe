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
import { formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { getSavedChartType, withAlpha, type ChartSeriesType } from '@/lib/chart-types';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChartToolbar } from '@/components/shared/ChartToolbar';
import { ChartLegendOverlay, type LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';


const CHART_ID = 'widget-drawdown';

export default function WidgetDrawdownChart() {
  const { t } = useTranslation('dashboard');
  const { isPrivate } = usePrivacy();
  const { danger } = useChartColors();

  const [chartType, setChartType] = useState<ChartSeriesType>(
    () => getSavedChartType(CHART_ID) ?? 'area',
  );

  const { containerRef, chartRef, ready } = useLightweightChart({
    options: {
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      leftPriceScale: { visible: false },
    },
  });

  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // Incremented after each series rebuild to trigger a re-render so legendItems picks up
  // the fresh seriesRef.current (refs don't cause re-renders on their own).
  const [seriesVersion, setSeriesVersion] = useState(0);

  const { data, isLoading, isError, error, isFetching } = useWidgetChartCalculation();

  const rawChartData = useMemo(
    () =>
      (data ?? [])
        .map((p) => ({
          time: p.date as string,
          value: -parseFloat(p.drawdown),
        }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)), // native-ok
    [data],
  );

  // Create or recreate the series when chart type or colors change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || !rawChartData.length) return;

    // Remove existing series (guard: chart may be destroyed during unmount)
    try {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
    } catch { seriesRef.current = null; return; }

    let series: ISeriesApi<SeriesType>;

    switch (chartType) {
      case 'line':
        series = chart.addSeries(LineSeries, {
          color: danger,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        break;
      case 'baseline':
        series = chart.addSeries(BaselineSeries, {
          baseValue: { type: 'price', price: 0 },
          topLineColor: danger,
          topFillColor1: withAlpha(danger, 0.25),
          topFillColor2: 'transparent',
          bottomLineColor: danger,
          bottomFillColor1: 'transparent',
          bottomFillColor2: 'transparent',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        break;
      case 'histogram':
        series = chart.addSeries(HistogramSeries, {
          color: withAlpha(danger, 0.69),
          lastValueVisible: false,
          priceLineVisible: false,
        });
        break;
      case 'area':
      default:
        series = chart.addSeries(AreaSeries, {
          lineColor: danger,
          topColor: withAlpha(danger, 0.25),
          bottomColor: 'transparent',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        break;
    }

    series.priceScale().applyOptions({
      mode: 0,
    });
    series.applyOptions({
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `${(price * 100).toFixed(2)}%`, // native-ok
      },
    } as Record<string, unknown>);
    series.setData(rawChartData);
    chart.timeScale().fitContent();
    seriesRef.current = series;
    setSeriesVersion((v) => v + 1); // native-ok — triggers re-render to refresh legendItems
  }, [chartType, danger, data, ready]);

  // Build legend items — depends on seriesVersion so it re-derives after every series rebuild
  const legendItems: LegendSeriesItem[] = seriesVersion > 0 && seriesRef.current
    ? [
        {
          id: 'drawdown',
          label: t('widgetTypes.drawdown-chart'),
          color: danger,
          series: seriesRef.current,
          visible: true,
          formatValue: (v: number) => formatPercentage(v),
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

  return (
    <div className="flex flex-col" style={{ height: 280 }}>
      {isLoading && <Skeleton className="absolute inset-0 rounded-lg z-20" />}
      {!isLoading && !rawChartData.length && (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          {t('noChartData')}
        </div>
      )}
      <div className="flex items-center justify-between shrink-0">
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
