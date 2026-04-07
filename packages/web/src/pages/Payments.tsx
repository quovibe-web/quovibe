import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
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
import { formatDate } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useChartTheme } from '@/hooks/use-chart-theme';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { useAnalyticsContext } from '@/context/analytics-context';
import { cn, txTypeKey } from '@/lib/utils';
import type { PaymentGroup } from '@/api/types';

type AmountMode = 'gross' | 'net';

function PaymentBarChart({
  groups,
  amountMode,
  color,
  title,
  isPrivate,
  type,
  groupBy,
}: {
  groups: PaymentGroup[];
  amountMode: AmountMode;
  color: string;
  title: string;
  isPrivate: boolean;
  type: 'DIVIDEND' | 'INTEREST';
  groupBy: 'month' | 'quarter' | 'year';
}) {
  const { i18n } = useTranslation('common');
  const { gridColor, gridOpacity, tickColor, isDark } = useChartTheme();
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const { periodStart, periodEnd } = useReportingPeriod();

  const chartData = groups.map((g) => ({
    bucket: g.bucket,
    total: parseFloat(amountMode === 'gross' ? g.totalGross : g.totalNet),
  }));

  const handleMouseMove = useCallback((state: { activeLabel?: string }) => {
    const bucket = state?.activeLabel ?? null;
    if (!bucket) return;
    // Prefetch immediately — fetch starts 250ms before debounce fires
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
  }, [queryClient, periodStart, periodEnd, type, groupBy]);

  const handleMouseLeave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setActiveBucket(null);
  }, []);

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
        <div style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={gridOpacity} vertical={false} />
              <XAxis
                dataKey="bucket"
                tick={{ fill: tickColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tick={{ fill: tickColor, fontSize: 11, style: { fontFeatureSettings: '"tnum"' } }}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                tickFormatter={(v: number) =>
                  new Intl.NumberFormat(i18n.language, {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  }).format(v)
                }
              />
              <Tooltip
                cursor={false}
                wrapperStyle={{ outline: 'none' }}
                content={(props) => (
                  <PaymentBreakdownTooltip
                    {...props}
                    activeBucket={activeBucket}
                    type={type}
                    groupBy={groupBy}
                    amountMode={amountMode}
                  />
                )}
              />
              <Bar
                dataKey="total"
                fill={color}
                radius={[3, 3, 0, 0]}
                animationDuration={600}
                animationEasing="ease-out"
                activeBar={{ style: { filter: isDark ? 'brightness(1.6) saturate(1.5)' : 'brightness(1.15) saturate(1.2)', transition: 'filter 0.15s ease' } }}
              />
            </BarChart>
          </ResponsiveContainer>
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
              color={dividend}
              title={t('payments.dividendsPerGroup', { groupBy: t(`payments.groupBy.${groupBy}`) })}
              isPrivate={isPrivate}
              type="DIVIDEND"
              groupBy={groupBy}
            />
          </div>

          {/* Section B: Interest Chart */}
          <div className="mt-6">
            <PaymentBarChart
              groups={data?.interestGroups ?? []}
              amountMode={amountMode}
              color={interest}
              title={t('payments.interestPerGroup', { groupBy: t(`payments.groupBy.${groupBy}`) })}
              isPrivate={isPrivate}
              type="INTEREST"
              groupBy={groupBy}
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
