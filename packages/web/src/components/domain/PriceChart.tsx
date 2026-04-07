import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineSeries, AreaSeries, CandlestickSeries, BarSeries, BaselineSeries, HistogramSeries,
  createSeriesMarkers,
  type ISeriesApi, type SeriesType, type MouseEventParams, type ISeriesMarkersPluginApi,
} from 'lightweight-charts';
import { formatDate, formatQuote } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useLightweightChart } from '@/hooks/use-lightweight-chart';
import { getSavedChartType, type ChartSeriesType } from '@/lib/chart-types';
import { ChartToolbar } from '@/components/shared/ChartToolbar';
import { ChartLegendOverlay, type LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';
import { FadeIn } from '@/components/shared/FadeIn';
import { cn } from '@/lib/utils';

interface PricePoint {
  date: string;
  value: string;
  open?: string | null;
  high?: string | null;
  low?: string | null;
  volume?: number | null;
}

interface TransactionMarker {
  date: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  amount?: number;
  currency?: string;
}

interface PriceChartProps {
  prices: PricePoint[];
  transactions?: TransactionMarker[];
  isFetching?: boolean;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  items: TransactionMarker[];
  date: string;
}

const CHART_ID = 'price-chart';

export function PriceChart({ prices, transactions = [], isFetching }: PriceChartProps) {
  const { t } = useTranslation('securities');
  const { isPrivate } = usePrivacy();
  const { profit, loss, violet, palette } = useChartColors();
  const { quotesPrecision } = useDisplayPreferences();

  // Determine OHLC availability from data
  const hasOhlc = prices.length > 0 && prices.some(p => p.open != null);

  const [chartType, setChartType] = useState<ChartSeriesType>(
    () => {
      if (hasOhlc) {
        return getSavedChartType(CHART_ID) ?? 'candlestick';
      }
      return getSavedChartType(CHART_ID) ?? 'line';
    },
  );

  // If saved type is OHLC but data doesn't support it, fall back
  const effectiveType = (!hasOhlc && (chartType === 'candlestick' || chartType === 'bar'))
    ? 'line'
    : chartType;

  const { containerRef, chartRef, ready } = useLightweightChart({
    options: {
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      leftPriceScale: { visible: false },
    },
  });

  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<string> | null>(null);
  const [seriesVersion, setSeriesVersion] = useState(0); // native-ok
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, items: [], date: '',
  });

  // Build lookup of transactions by date
  const txByDate = new Map<string, TransactionMarker[]>();
  for (const tx of transactions) {
    const existing = txByDate.get(tx.date) ?? [];
    existing.push(tx);
    txByDate.set(tx.date, existing);
  }

  // Sort prices by time ascending (required by Lightweight Charts)
  const sortedPrices = [...prices].sort(
    (a, b) => a.date.localeCompare(b.date), // native-ok
  );

  // Has volume data?
  const hasVolume = sortedPrices.some(p => p.volume != null && p.volume > 0); // native-ok

  const fmtQuote = useCallback(
    (v: number) => formatQuote(v, { quotesPrecision }),
    [quotesPrecision],
  );

  // Click handler for marker tooltip
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleClick = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setTooltip(prev => ({ ...prev, visible: false }));
        return;
      }

      const dateStr = param.time as string;
      const txsAtDate = txByDate.get(dateStr);

      if (txsAtDate && txsAtDate.length > 0) { // native-ok
        setTooltip({
          visible: true,
          x: param.point.x,
          y: param.point.y,
          items: txsAtDate,
          date: dateStr,
        });
      } else {
        setTooltip(prev => ({ ...prev, visible: false }));
      }
    };

    chart.subscribeClick(handleClick);
    return () => chart.unsubscribeClick(handleClick);
  }, [transactions, chartRef.current]);

  // Create or recreate series when chart type, colors, or data change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || sortedPrices.length === 0) return; // native-ok

    // Remove existing series (guard: chart may have been destroyed by hook cleanup)
    try {
      if (markersPluginRef.current) {
        markersPluginRef.current.detach();
        markersPluginRef.current = null;
      }
      if (volumeSeriesRef.current) {
        chart.removeSeries(volumeSeriesRef.current);
        volumeSeriesRef.current = null;
      }
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
    } catch {
      // Chart already destroyed during unmount — safe to ignore
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      markersPluginRef.current = null;
      return;
    }

    let series: ISeriesApi<SeriesType>;

    // Build data arrays
    const singleValueData = sortedPrices.map(p => ({
      time: p.date as string,
      value: parseFloat(p.value),
    }));

    const ohlcData = sortedPrices.map(p => ({
      time: p.date as string,
      open: parseFloat(p.open ?? p.value),
      high: parseFloat(p.high ?? p.value),
      low: parseFloat(p.low ?? p.value),
      close: parseFloat(p.value),
    }));

    // Create series based on type
    switch (effectiveType) {
      case 'candlestick':
        series = chart.addSeries(CandlestickSeries, {
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(ohlcData);
        break;

      case 'bar':
        series = chart.addSeries(BarSeries, {
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(ohlcData);
        break;

      case 'area':
        series = chart.addSeries(AreaSeries, {
          lineColor: palette[0],
          topColor: palette[0] + '40',
          bottomColor: 'transparent',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(singleValueData);
        break;

      case 'baseline':
        series = chart.addSeries(BaselineSeries, {
          baseValue: { type: 'price', price: singleValueData[0]?.value ?? 0 },
          topLineColor: profit,
          topFillColor1: profit + '30',
          topFillColor2: 'transparent',
          bottomLineColor: loss,
          bottomFillColor1: 'transparent',
          bottomFillColor2: loss + '30',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(singleValueData);
        break;

      case 'histogram':
        series = chart.addSeries(HistogramSeries, {
          color: palette[0] + 'b0',
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(singleValueData);
        break;

      case 'line':
      default:
        series = chart.addSeries(LineSeries, {
          color: palette[0],
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(singleValueData);
        break;
    }

    seriesRef.current = series;

    // Add volume pane if data available
    if (hasVolume) {
      const volumeData = sortedPrices
        .filter(p => p.volume != null)
        .map(p => ({
          time: p.date as string,
          value: p.volume as number,
          color: 'rgba(128, 128, 128, 0.3)',
        }));

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false,
      }, 1);

      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      volumeSeries.setData(volumeData);
      volumeSeriesRef.current = volumeSeries;
    }

    // Add transaction markers
    if (transactions.length > 0) { // native-ok
      const priceDateSet = new Set(sortedPrices.map(p => p.date));
      const markers = transactions
        .filter(tx => priceDateSet.has(tx.date))
        .map(tx => ({
          time: tx.date as string,
          position: tx.type === 'SELL' ? 'aboveBar' as const : 'belowBar' as const,
          color: tx.type === 'BUY' ? profit
            : tx.type === 'SELL' ? loss
            : violet,
          shape: 'circle' as const,
          text: tx.type.charAt(0),
        }));

      markers.sort((a, b) => (a.time as string).localeCompare(b.time as string));

      if (markers.length > 0) { // native-ok
        markersPluginRef.current = createSeriesMarkers(series, markers);
      }
    }

    chart.timeScale().fitContent();
    setSeriesVersion(v => v + 1); // native-ok

  }, [effectiveType, profit, loss, violet, palette[0], prices, transactions, hasVolume]);

  function markerColor(type: string) {
    if (type === 'BUY') return profit;
    if (type === 'SELL') return loss;
    return violet;
  }

  const handleTypeChange = (type: ChartSeriesType) => {
    setChartType(type);
  };

  // Build legend items
  const legendItems: LegendSeriesItem[] = seriesVersion > 0 && seriesRef.current
    ? [
        {
          id: 'price',
          label: t('priceChart.price'),
          color: palette[0],
          series: seriesRef.current,
          visible: true,
          formatValue: fmtQuote,
        },
      ]
    : [];

  if (prices.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('priceChart.noData')}</p>;
  }

  return (
    <FadeIn>
      <div
        className={cn(
          'group/chart relative',
          isFetching && 'opacity-60 transition-opacity duration-200',
        )}
        style={{
          height: 280,
          filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
          transition: 'filter 0.2s ease',
        }}
      >
        <div ref={containerRef} className="w-full h-full" />

        <ChartLegendOverlay
          chart={chartRef.current}
          items={legendItems}
        />

        <ChartToolbar
          chartId={CHART_ID}
          activeType={effectiveType}
          hasOhlc={hasOhlc}
          onTypeChange={handleTypeChange}
        />

        {/* Marker click tooltip */}
        {tooltip.visible && (
          <div
            className="absolute z-20 rounded-md border bg-popover px-3 py-2 text-sm shadow-md"
            style={{
              left: Math.min(tooltip.x, (containerRef.current?.clientWidth ?? 300) - 180),
              top: Math.max(0, tooltip.y - 80),
              minWidth: 140,
              pointerEvents: 'none',
            }}
          >
            <div className="font-medium text-foreground mb-1">
              {formatDate(tooltip.date)}
            </div>
            {tooltip.items.map((tx, i) => (
              <div key={i} className="flex items-center gap-1.5" style={{ color: markerColor(tx.type) }}>
                <span className="font-medium">
                  {tx.type === 'DIVIDEND' ? t('priceChart.div') : tx.type}
                </span>
                {tx.amount != null && tx.currency && (
                  <span className="tabular-nums">
                    {fmtQuote(tx.amount)} {tx.currency}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
