import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  parseISO,
  format,
  getYear,
  getQuarter,
  eachMonthOfInterval,
  eachQuarterOfInterval,
  eachYearOfInterval,
} from 'date-fns';
import { useNavTitle } from '@/hooks/useNavTitle';
import {
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { usePayments, paymentsBreakdownQueryOptions } from '@/api/use-reports';
import { useReportingPeriod } from '@/api/use-performance';
import { useScopedApi } from '@/api/use-scoped-api';
import { PaymentBreakdownTooltip } from '@/components/domain/PaymentBreakdownTooltip';
import { AggregatedPaymentTooltip } from '@/components/domain/AggregatedPaymentTooltip';
import { formatDate, formatNumber } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useChartTheme } from '@/hooks/use-chart-theme';
import { useActiveBar } from '@/hooks/use-active-bar';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { useAnalyticsContext } from '@/context/analytics-context';
import { cn, txTypeKey } from '@/lib/utils';
import type { PaymentGroup } from '@/api/types';

const compactNumberFormat = (v: number) =>
  formatNumber(v, { notation: 'compact', maximumFractionDigits: 1 });

const ANCHORED_TOOLTIP_WRAPPER_STYLE: CSSProperties = {
  outline: 'none',
  pointerEvents: 'none',
  transition: 'none',
};

type RechartsTooltipContentProps = TooltipContentProps<ValueType, NameType>;

type AmountMode = 'gross' | 'net';

type TimeGroupByMode = 'month' | 'quarter' | 'year';

type GroupByMode = TimeGroupByMode | 'security' | 'type';

// Mirror the backend bucketKey() shape in packages/api/src/services/reports.service.ts:
// year → "yyyy", quarter → "yyyy-Qn", month → "yyyy-MM".
function bucketKeyForDate(d: Date, groupBy: TimeGroupByMode): string {
  if (groupBy === 'year') return String(getYear(d));
  if (groupBy === 'quarter') return `${getYear(d)}-Q${getQuarter(d)}`;
  return format(d, 'yyyy-MM');
}

function padBuckets(
  groups: PaymentGroup[],
  amountMode: AmountMode,
  groupBy: TimeGroupByMode,
  periodStart: string,
  periodEnd: string,
): Array<{ bucket: string; total: number }> {
  const start = parseISO(periodStart);
  const end = parseISO(periodEnd);
  if (!(start instanceof Date) || !(end instanceof Date) || isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [];
  }

  const valueByBucket = new Map<string, number>();
  for (const g of groups) {
    valueByBucket.set(g.bucket, parseFloat(amountMode === 'gross' ? g.totalGross : g.totalNet));
  }

  const dates =
    groupBy === 'month'
      ? eachMonthOfInterval({ start, end })
      : groupBy === 'quarter'
        ? eachQuarterOfInterval({ start, end })
        : eachYearOfInterval({ start, end });

  return dates
    .map((d) => {
      const bucket = bucketKeyForDate(d, groupBy);
      return { bucket, total: valueByBucket.get(bucket) ?? 0 };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

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
  groupBy: TimeGroupByMode;
}) {
  const { gridColor, gridOpacity, tickColor, isDark } = useChartTheme();
  const queryClient = useQueryClient();
  const { periodStart, periodEnd } = useReportingPeriod();
  const api = useScopedApi();

  // Pad missing buckets with zero totals so the x-axis is a continuous timeline
  // instead of skipping months/quarters that had no payments.
  const chartData = useMemo(
    () => padBuckets(groups, amountMode, groupBy, periodStart, periodEnd),
    [groups, amountMode, groupBy, periodStart, periodEnd],
  );

  const { activeBar, barHandlers, tooltipProps } = useActiveBar((bucket) => {
    queryClient.prefetchQuery(
      paymentsBreakdownQueryOptions(api, bucket, type, groupBy, periodStart, periodEnd),
    );
  });

  // Preserve "no data at all → hide chart" UX: only render when the API returned
  // at least one bucket. Padding only fills gaps between real payments.
  if (groups.length === 0 || chartData.length === 0) return null;

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
                tickFormatter={compactNumberFormat}
              />
              <Tooltip
                {...tooltipProps}
                cursor={false}
                wrapperStyle={ANCHORED_TOOLTIP_WRAPPER_STYLE}
                content={(props: RechartsTooltipContentProps) => (
                  <PaymentBreakdownTooltip
                    {...props}
                    activeBucket={activeBar?.bucket ?? null}
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
                {...barHandlers}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Aggregated-chart helpers ────────────────────────────────────────────────

function aggregateBySecurity(
  combinedGroups: PaymentGroup[],
  amountMode: AmountMode,
  cashLabel: string,
): Array<{ bucket: string; total: number }> {
  const totals = new Map<string, number>();
  for (const group of combinedGroups) {
    for (const payment of group.payments) {
      const key = payment.securityName ?? cashLabel;
      const amount = parseFloat(amountMode === 'gross' ? payment.grossAmount : payment.netAmount);
      totals.set(key, (totals.get(key) ?? 0) + amount);
    }
  }
  return Array.from(totals.entries())
    .map(([bucket, total]) => ({ bucket, total }))
    .sort((a, b) => b.total - a.total);
}

function aggregateByType(
  combinedGroups: PaymentGroup[],
  amountMode: AmountMode,
  dividendLabel: string,
  interestLabel: string,
): Array<{ bucket: string; total: number; isDividend: boolean }> {
  let dividendTotal = 0;
  let interestTotal = 0;
  for (const group of combinedGroups) {
    for (const payment of group.payments) {
      const amount = parseFloat(amountMode === 'gross' ? payment.grossAmount : payment.netAmount);
      if (payment.type === 'DIVIDEND') {
        dividendTotal += amount;
      } else {
        interestTotal += amount;
      }
    }
  }
  const result: Array<{ bucket: string; total: number; isDividend: boolean }> = [];
  if (dividendTotal > 0) result.push({ bucket: dividendLabel, total: dividendTotal, isDividend: true });
  if (interestTotal > 0) result.push({ bucket: interestLabel, total: interestTotal, isDividend: false });
  return result;
}

// ─── AggregatedBarChart ───────────────────────────────────────────────────────

function AggregatedBarChart({
  combinedGroups,
  groupBy,
  amountMode,
  isPrivate,
  dividendColor,
  interestColor,
}: {
  combinedGroups: PaymentGroup[];
  groupBy: 'security' | 'type';
  amountMode: AmountMode;
  isPrivate: boolean;
  dividendColor: string;
  interestColor: string;
}) {
  const { t } = useTranslation('reports');
  const { gridColor, gridOpacity, tickColor, isDark } = useChartTheme();
  const { barHandlers, tooltipProps } = useActiveBar();

  const cashLabel = t('payments.cashOrNoSecurity');
  const dividendLabel = t('payments.dividends');
  const interestLabel = t('payments.interest');

  const chartData = useMemo(() => {
    if (groupBy === 'security') {
      return aggregateBySecurity(combinedGroups, amountMode, cashLabel).map((d) => ({ ...d, color: dividendColor }));
    }
    return aggregateByType(combinedGroups, amountMode, dividendLabel, interestLabel).map((d) => ({
      ...d,
      color: d.isDividend ? dividendColor : interestColor,
    }));
  }, [combinedGroups, groupBy, amountMode, cashLabel, dividendLabel, interestLabel, dividendColor, interestColor]);

  if (chartData.length === 0) return null;

  const title = t('payments.byTitle', { groupBy: t(`payments.groupBy.${groupBy}`) });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
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
                tickFormatter={compactNumberFormat}
              />
              <Tooltip
                {...tooltipProps}
                cursor={false}
                wrapperStyle={ANCHORED_TOOLTIP_WRAPPER_STYLE}
                content={(props: RechartsTooltipContentProps) => (
                  <AggregatedPaymentTooltip {...props} amountMode={amountMode} />
                )}
              />
              <Bar
                dataKey="total"
                radius={[3, 3, 0, 0]}
                animationDuration={600}
                animationEasing="ease-out"
                activeBar={{ style: { filter: isDark ? 'brightness(1.6) saturate(1.5)' : 'brightness(1.15) saturate(1.2)', transition: 'filter 0.15s ease' } }}
                fill={dividendColor}
                {...barHandlers}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Payments() {
  const { t } = useTranslation('reports');
  useNavTitle('income');
  const [groupBy, setGroupBy] = useState<GroupByMode>('month');
  const [amountMode, setAmountMode] = useState<AmountMode>('gross');
  const apiGroupBy: TimeGroupByMode =
    groupBy === 'security' || groupBy === 'type' ? 'month' : groupBy;
  const { data, isLoading, isFetching } = usePayments(apiGroupBy);
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
        <SegmentedControl
          segments={[
            { value: 'gross', label: t('payments.gross') },
            { value: 'net', label: t('payments.net') },
          ]}
          value={amountMode}
          onChange={setAmountMode}
        />

        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupByMode)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">{t('payments.groupBy.month')}</SelectItem>
            <SelectItem value="quarter">{t('payments.groupBy.quarter')}</SelectItem>
            <SelectItem value="year">{t('payments.groupBy.year')}</SelectItem>
            <SelectItem value="security">{t('payments.groupBy.security')}</SelectItem>
            <SelectItem value="type">{t('payments.groupBy.type')}</SelectItem>
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
            <Card style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '0ms' }}>
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

          {/* Section A: Dividends Chart — time-bucket modes only */}
          {(groupBy === 'month' || groupBy === 'quarter' || groupBy === 'year') && (
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
          )}

          {/* Section B: Interest Chart — time-bucket modes only */}
          {(groupBy === 'month' || groupBy === 'quarter' || groupBy === 'year') && (
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
          )}

          {/* Section A2: Aggregated chart — security / type modes */}
          {(groupBy === 'security' || groupBy === 'type') && data && (
            <AggregatedBarChart
              combinedGroups={data.combinedGroups}
              groupBy={groupBy}
              amountMode={amountMode}
              isPrivate={isPrivate}
              dividendColor={dividend}
              interestColor={interest}
            />
          )}

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
                              currency={payment.currencyCode}
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
