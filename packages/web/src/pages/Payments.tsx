import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Coins, Percent, Receipt } from 'lucide-react';
import { useNavTitle } from '@/hooks/useNavTitle';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { EmptyState } from '@/components/shared/EmptyState';
import { usePayments } from '@/api/use-reports';
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
import { useReportingPeriod } from '@/api/use-performance';
import { IncomeHero } from '@/components/domain/IncomeHero';
import { IncomeCalendar } from '@/components/domain/IncomeCalendar';
import { IncomeStackedBar } from '@/components/domain/IncomeStackedBar';
import { IncomeRightRail } from '@/components/domain/IncomeRightRail';
import {
  IncomeDetailList,
  type IncomeDetailListHandle,
} from '@/components/domain/IncomeDetailList';
import {
  parseFilterUrlParams,
  serializeFilterUrlParams,
  type DetailFilters,
  type DetailSort,
  type DetailFilterType,
} from '@/components/domain/IncomeDetailList.utils';
import { cn, txTypeKey } from '@/lib/utils';
import type { PaymentGroup } from '@/api/types';

const compactNumberFormat = (v: number) =>
  formatNumber(v, { notation: 'compact', maximumFractionDigits: 1 });

const ANCHORED_TOOLTIP_WRAPPER_STYLE = {
  outline: 'none',
  pointerEvents: 'none' as const,
  transition: 'none',
};

type AmountMode = 'gross' | 'net';
type TimeGroupByMode = 'month' | 'quarter' | 'year';
type GroupByMode = TimeGroupByMode | 'security' | 'type';

// ─── Aggregated chart helpers (kept for security/type modes) ───────────────

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

function aggregateByTypeChart(
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
      if (payment.type === 'DIVIDEND') dividendTotal += amount;
      else interestTotal += amount;
    }
  }
  const result: Array<{ bucket: string; total: number; isDividend: boolean }> = [];
  if (dividendTotal > 0) result.push({ bucket: dividendLabel, total: dividendTotal, isDividend: true });
  if (interestTotal > 0) result.push({ bucket: interestLabel, total: interestTotal, isDividend: false });
  return result;
}

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
    return aggregateByTypeChart(combinedGroups, amountMode, dividendLabel, interestLabel).map((d) => ({
      ...d,
      color: d.isDividend ? dividendColor : interestColor,
    }));
  }, [combinedGroups, groupBy, amountMode, cashLabel, dividendLabel, interestLabel, dividendColor, interestColor]);

  if (chartData.length === 0) return null;
  const title = t('payments.byTitle', { groupBy: t(`payments.groupBy.${groupBy}`) });

  return (
    <Card className="mt-6 rounded-md">
      <CardHeader>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={gridOpacity} vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tick={{ fill: tickColor, fontSize: 11, style: { fontFeatureSettings: '"tnum"' } }} tickLine={false} axisLine={false} tickMargin={4} tickFormatter={compactNumberFormat} />
              <Tooltip
                {...tooltipProps}
                cursor={false}
                wrapperStyle={ANCHORED_TOOLTIP_WRAPPER_STYLE}
                content={(props: TooltipContentProps<ValueType, NameType>) => (
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

// ─── Page ──────────────────────────────────────────────────────────────────

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
  const { periodEnd } = useReportingPeriod();

  const [searchParams, setSearchParams] = useSearchParams();
  const { filters: detailFilters, sort: detailSort } = useMemo(
    () => parseFilterUrlParams(searchParams),
    [searchParams],
  );

  const updateUrlState = useCallback(
    (filters: DetailFilters, sort: DetailSort) => {
      const next = serializeFilterUrlParams(filters, sort);
      // Preserve other params (periodStart/periodEnd)
      for (const [k, v] of searchParams.entries()) {
        if (k !== 'filterType' && k !== 'securityIds' && k !== 'sort') next.set(k, v);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilters = useCallback(
    (filters: DetailFilters) => updateUrlState(filters, detailSort),
    [updateUrlState, detailSort],
  );
  const setSort = useCallback(
    (sort: DetailSort) => updateUrlState(detailFilters, sort),
    [updateUrlState, detailFilters],
  );
  const clearFilters = useCallback(
    () => updateUrlState({ type: null, securityIds: [] }, detailSort),
    [updateUrlState, detailSort],
  );

  const onTypeFilterToggle = useCallback(
    (type: 'DIVIDEND' | 'INTEREST') => {
      const next: DetailFilterType = detailFilters.type === type ? null : type;
      setFilters({ ...detailFilters, type: next });
    },
    [detailFilters, setFilters],
  );

  // Map securityName → securityId for the right-rail Top Payers links.
  const securityIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of data?.combinedGroups ?? []) {
      for (const p of g.payments) {
        if (p.securityName && p.securityId && !map.has(p.securityName)) {
          map.set(p.securityName, p.securityId);
        }
      }
    }
    return map;
  }, [data]);

  const detailListRef = useRef<IncomeDetailListHandle>(null);
  const handleMonthClick = useCallback((bucket: string) => {
    detailListRef.current?.scrollToMonth(bucket);
  }, []);

  useEffect(() => {
    setSubtitle(t('payments.subtitle'));
    return () => { setSubtitle(''); setActions(null); };
  }, [t, setSubtitle, setActions]);

  useEffect(() => {
    setActions(
      <div className="flex items-center gap-3">
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

  const isTimeMode = groupBy === 'month' || groupBy === 'quarter' || groupBy === 'year';
  const showRail = isTimeMode && (data?.combinedGroups.length ?? 0) > 0;

  return (
    <>
      {isLoading ? (
        <>
          <ChartSkeleton height={140} />
          <ChartSkeleton height={200} />
          <ChartSkeleton height={280} />
          <SectionSkeleton rows={5} />
        </>
      ) : (
        <div className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity duration-200')}>
          <FadeIn>
            <div className={cn('grid grid-cols-1 gap-6', showRail && 'lg:grid-cols-[minmax(0,1fr)_220px]')}>
              {/* Hero — full-width even at lg+ */}
              <div className={cn(showRail && 'lg:col-span-2')} style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '0ms' }}>
                <IncomeHero amountMode={amountMode} />
              </div>

              {/* Calendar — full-width even at lg+ */}
              {isTimeMode && (
                <div className={cn(showRail && 'lg:col-span-2')} style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '60ms' }}>
                  <IncomeCalendar
                    amountMode={amountMode}
                    pageGroupBy={groupBy}
                    onMonthClick={handleMonthClick}
                  />
                </div>
              )}

              {/* Main column: bar chart + detail list */}
              <div>
                {isTimeMode && data && (
                  <IncomeStackedBar
                    dividendGroups={data.dividendGroups}
                    interestGroups={data.interestGroups}
                    amountMode={amountMode}
                    groupBy={groupBy}
                    periodStart={data.periodStart}
                    periodEnd={data.periodEnd}
                    onBarClick={handleMonthClick}
                  />
                )}

                {!isTimeMode && data && (
                  <AggregatedBarChart
                    combinedGroups={data.combinedGroups}
                    groupBy={groupBy}
                    amountMode={amountMode}
                    isPrivate={isPrivate}
                    dividendColor={dividend}
                    interestColor={interest}
                  />
                )}

                <div className="mt-6">
                  {isTimeMode ? (
                    <IncomeDetailList
                      ref={detailListRef}
                      combinedGroups={data?.combinedGroups ?? []}
                      amountMode={amountMode}
                      groupBy={groupBy}
                      filters={detailFilters}
                      sort={detailSort}
                      onFiltersChange={setFilters}
                      onSortChange={setSort}
                      onClearFilters={clearFilters}
                      periodEnd={periodEnd}
                    />
                  ) : (
                    <LegacyAggregatedDetailList
                      groups={data?.combinedGroups ?? []}
                      amountMode={amountMode}
                    />
                  )}
                </div>
              </div>

              {/* Right rail */}
              {showRail && data && (
                <div>
                  <IncomeRightRail
                    combinedGroups={data.combinedGroups}
                    amountMode={amountMode}
                    activeTypeFilter={detailFilters.type}
                    onTypeFilterToggle={onTypeFilterToggle}
                    securityIdByName={securityIdByName}
                  />
                </div>
              )}
            </div>
          </FadeIn>
        </div>
      )}
    </>
  );
}

// Legacy detail list used only in security/type modes (no year axis).
function LegacyAggregatedDetailList({
  groups,
  amountMode,
}: {
  groups: PaymentGroup[];
  amountMode: AmountMode;
}) {
  const { t } = useTranslation('reports');
  const { t: txT } = useTranslation('transactions');
  if (groups.length === 0) {
    return <EmptyState icon={Receipt} title={t('payments.empty.noPayments')} />;
  }
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.bucket} id={`payment-bucket-${group.bucket}`} className="rounded-md scroll-mt-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{group.bucket}</CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{t('payments.paymentCount', { count: group.count })}</span>
                <CurrencyDisplay
                  value={parseFloat(amountMode === 'gross' ? group.totalGross : group.totalNet)}
                  className="qv-numeric font-medium text-foreground"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--qv-border-subtle)]">
                  <th className="qv-eyebrow text-left px-4 py-2">{t('payments.columns.date')}</th>
                  <th className="qv-eyebrow text-left px-4 py-2">{t('payments.columns.type')}</th>
                  <th className="qv-eyebrow text-left px-4 py-2">{t('payments.columns.security')}</th>
                  <th className="qv-eyebrow text-left px-4 py-2">{t('payments.columns.account')}</th>
                  <th className="qv-eyebrow text-right px-4 py-2">{t('payments.columns.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {group.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-[var(--qv-border-subtle)] last:border-0 hover:bg-[var(--qv-surface-3)]">
                    <td className="qv-numeric px-4 py-2">{formatDate(payment.date)}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="rounded-sm gap-1">
                        {payment.type === 'DIVIDEND' ? (
                          <Coins className="h-3 w-3" />
                        ) : (
                          <Percent className="h-3 w-3" />
                        )}
                        {txT(`types.${txTypeKey(payment.type)}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{payment.securityName ?? '—'}</td>
                    <td className="px-4 py-2">{payment.accountName ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <CurrencyDisplay
                        value={parseFloat(amountMode === 'gross' ? payment.grossAmount : payment.netAmount)}
                        currency={payment.currencyCode ?? undefined}
                        className="qv-numeric"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
