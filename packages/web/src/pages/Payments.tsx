import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  LineSeries, AreaSeries, HistogramSeries,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { usePayments, reportsKeys } from '@/api/use-reports';
import { useReportingPeriod } from '@/api/use-performance';
import { apiFetch } from '@/api/fetch';
import { PaymentBreakdownTooltip } from '@/components/domain/PaymentBreakdownTooltip';
import type { PaymentBreakdownResponse } from '@quovibe/shared';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useLightweightChart } from '@/hooks/use-lightweight-chart';
import { getColor } from '@/lib/colors';
import { getSavedChartType, type ChartSeriesType } from '@/lib/chart-types';
import { ChartToolbar } from '@/components/shared/ChartToolbar';
import { ChartLegendOverlay, type LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { useAnalyticsContext } from '@/context/analytics-context';
import { cn, txTypeKey } from '@/lib/utils';
import type { PaymentGroup } from '@/api/types';

type AmountMode = 'gross' | 'net';

interface PaymentBarChartProps {
  groups: PaymentGroup[];
  amountMode: AmountMode;
  barColor: string;
  title: string;
  isPrivate: boolean;
  type: 'DIVIDEND' | 'INTEREST';
  groupBy: 'month' | 'quarter' | 'year';
  chartId: string;
}

function PaymentBarChart({
  groups,
  amountMode,
  barColor,
  title,
  isPrivate,
  type,
  groupBy,
  chartId,
}: PaymentBarChartProps) {
  const { periodStart, periodEnd } = useReportingPeriod();
  const queryClient = useQueryClient();

  const [chartType, setChartType] = useState<ChartSeriesType>(
    () => getSavedChartType(chartId) ?? 'histogram',
  );
  const [seriesVersion, setSeriesVersion] = useState(0);
  const [activeBucket, setActiveBucket] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);

  const { containerRef, chartRef, ready } = useLightweightChart({
    options: {
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      leftPriceScale: { visible: false },
      crosshair: {
        vertLine: { visible: true },
        horzLine: { visible: false },
      },
    },
  });

  // Map data: PaymentGroup[] → LW time-series data
  const chartData = groups.map((g) => ({
    time: g.bucket as string,
    value: parseFloat(amountMode === 'gross' ? g.totalGross : g.totalNet),
  }));

  // Build per-point colored histogram data
  const histogramData = chartData.map((d) => ({
    ...d,
    color: d.value >= 0 ? getColor('profit') : getColor('loss'),
  }));

  // Create / recreate series when chart type or color changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;

    try {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
    } catch { seriesRef.current = null; return; }

    if (chartData.length === 0) return;

    let series: ISeriesApi<SeriesType>;

    switch (chartType) {
      case 'line':
        series = chart.addSeries(LineSeries, {
          color: barColor,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(chartData);
        break;
      case 'area':
        series = chart.addSeries(AreaSeries, {
          lineColor: barColor,
          topColor: barColor + '40',
          bottomColor: 'transparent',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(chartData);
        break;
      case 'histogram':
      default:
        series = chart.addSeries(HistogramSeries, {
          color: barColor,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        series.setData(histogramData);
        break;
    }

    chart.timeScale().fitContent();
    seriesRef.current = series;
    setSeriesVersion((v) => v + 1); // native-ok — triggers legend re-render
  }, [chartType, barColor, groups, amountMode]);

  // Legend items
  const legendItems: LegendSeriesItem[] = seriesVersion > 0 && seriesRef.current
    ? [
        {
          id: chartId,
          label: title,
          color: barColor,
          series: seriesRef.current,
          visible: true,
          formatValue: (v: number) => formatCurrency(v),
        },
      ]
    : [];

  // Crosshair move → prefetch breakdown tooltip
  // seriesVersion is used as a trigger so this effect re-runs once the chart is initialised
  // (chartRef is a ref; only seriesVersion causes a re-render after the chart is ready)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param: { time?: unknown; point?: { x: number; y: number } }) => {
      if (!param.time) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setActiveBucket(null);
        return;
      }
      const bucket = String(param.time);

      // Prefetch breakdown immediately
      queryClient.prefetchQuery({
        queryKey: reportsKeys.paymentsBreakdown(bucket, type, groupBy, periodStart, periodEnd),
        queryFn: () =>
          apiFetch<PaymentBreakdownResponse>(
            `/api/reports/payments/breakdown?bucket=${encodeURIComponent(bucket)}&type=${type}&groupBy=${groupBy}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
          ),
        staleTime: 5 * 60 * 1000,
      });

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setActiveBucket(bucket);
      }, 250);
    };

    chart.subscribeCrosshairMove(handler);
    return () => {
      chart.unsubscribeCrosshairMove(handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [seriesVersion, queryClient, type, groupBy, periodStart, periodEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="group/chart relative"
          style={{
            height: 240,
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
            chartId={chartId}
            activeType={chartType}
            hasOhlc={false}
            onTypeChange={setChartType}
          />
          {/* Breakdown tooltip rendered outside the chart canvas */}
          {activeBucket && (
            <div className="absolute bottom-2 left-2 z-20 pointer-events-none">
              <PaymentBreakdownTooltip
                active={true}
                payload={[{ value: chartData.find((d) => d.time === activeBucket)?.value ?? 0 }]}
                label={activeBucket}
                activeBucket={activeBucket}
                type={type}
                groupBy={groupBy}
                amountMode={amountMode}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Payments() {
  const { t } = useTranslation('reports');
  const [groupBy, setGroupBy] = useState<'month' | 'quarter' | 'year'>('month');
  const [amountMode, setAmountMode] = useState<AmountMode>('gross');
  const { data, isLoading, isFetching } = usePayments(groupBy);
  const { isPrivate } = usePrivacy();
  const { dividend, interest } = useChartColors();
  const { setActions, setSubtitle } = useAnalyticsContext();

  useEffect(() => {
    setSubtitle(t('payments.subtitle'));
    return () => { setSubtitle(''); setActions(null); };
  }, [t, setSubtitle, setActions]);

  useEffect(() => {
    setActions(
      <div className="flex items-center gap-3">
        {/* Gross / Net toggle */}
        <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              amountMode === 'gross'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setAmountMode('gross')}
          >
            {t('payments.gross')}
          </button>
          <button
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              amountMode === 'net'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setAmountMode('net')}
          >
            {t('payments.net')}
          </button>
        </div>

        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">{t('payments.groupBy.month')}</SelectItem>
            <SelectItem value="quarter">{t('payments.groupBy.quarter')}</SelectItem>
            <SelectItem value="year">{t('payments.groupBy.year')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }, [amountMode, groupBy, t, setActions]);

  const earningsValue = amountMode === 'gross'
    ? data?.totals.earningsGross
    : data?.totals.earningsNet;
  const dividendsValue = amountMode === 'gross'
    ? data?.totals.dividendsGross
    : data?.totals.dividendsNet;
  const interestValue = amountMode === 'gross'
    ? data?.totals.interestGross
    : data?.totals.interestNet;

  return (
    <>
      {isLoading ? (
        <>
          <ChartSkeleton height={100} />
          <ChartSkeleton height={240} />
          <ChartSkeleton height={240} />
          <SectionSkeleton rows={3} />
        </>
      ) : (
        <div className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity duration-200')}>
          <FadeIn>
          {/* Section 0: Earnings Summary Card */}
          {data && (
            <Card className="relative overflow-hidden" style={{ animation: 'qv-stagger-in 0.5s ease-out both', animationDelay: '0ms' }}>
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary opacity-80" />
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground mb-1">
                  {t('payments.earningsChart')}
                </div>
                <div className="text-2xl font-semibold tracking-tight">
                  <CurrencyDisplay value={parseFloat(earningsValue ?? '0')} />
                </div>
                <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                  <span>
                    {t('payments.dividends')}: <CurrencyDisplay value={parseFloat(dividendsValue ?? '0')} className="text-foreground font-medium" />
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    {t('payments.interest')}: <CurrencyDisplay value={parseFloat(interestValue ?? '0')} className="text-foreground font-medium" />
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section A: Dividends Chart */}
          <div className="mt-6">
            <PaymentBarChart
              groups={data?.dividendGroups ?? []}
              amountMode={amountMode}
              barColor={dividend}
              title={t('payments.dividendsPerGroup', { groupBy: t(`payments.groupBy.${groupBy}`) })}
              isPrivate={isPrivate}
              type="DIVIDEND"
              groupBy={groupBy}
              chartId="payments-dividends"
            />
          </div>

          {/* Section B: Interest Chart */}
          <div className="mt-6">
            <PaymentBarChart
              groups={data?.interestGroups ?? []}
              amountMode={amountMode}
              barColor={interest}
              title={t('payments.interestPerGroup', { groupBy: t(`payments.groupBy.${groupBy}`) })}
              isPrivate={isPrivate}
              type="INTEREST"
              groupBy={groupBy}
              chartId="payments-interest"
            />
          </div>

          {/* Section C: Combined Detail Cards */}
          <div className="space-y-4 mt-6">
            {(data?.combinedGroups ?? []).map((group) => (
              <Card key={group.bucket}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">{group.bucket}</CardTitle>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{t('payments.paymentCount', { count: group.count })}</span>
                      <CurrencyDisplay
                        value={parseFloat(amountMode === 'gross' ? group.totalGross : group.totalNet)}
                        className="font-medium text-foreground"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t('payments.columns.date')}</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t('payments.columns.type')}</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t('payments.columns.security')}</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t('payments.columns.account')}</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t('payments.columns.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.payments.map((payment) => (
                        <tr key={payment.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2">{formatDate(payment.date)}</td>
                          <td className="px-4 py-2">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                payment.type === 'DIVIDEND'
                                  ? 'bg-primary/15 text-primary'
                                  : 'bg-[var(--color-chart-5)]/15 text-[var(--color-chart-5)]',
                              )}
                            >
                              {t(`types.${txTypeKey(payment.type)}`, { ns: 'transactions' })}
                            </span>
                          </td>
                          <td className="px-4 py-2">{payment.securityName ?? '—'}</td>
                          <td className="px-4 py-2">{payment.accountName ?? '—'}</td>
                          <td className="px-4 py-2 text-right">
                            <CurrencyDisplay
                              value={parseFloat(amountMode === 'gross' ? payment.grossAmount : payment.netAmount)}
                              currency={payment.currencyCode ?? 'EUR'}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}
            {(data?.combinedGroups ?? []).length === 0 && (
              <p className="text-muted-foreground text-sm">{t('payments.empty')}</p>
            )}
          </div>
          </FadeIn>
        </div>
      )}
    </>
  );
}
