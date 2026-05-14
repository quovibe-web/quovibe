import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { differenceInCalendarMonths, parseISO, subYears, format } from 'date-fns';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import { usePayments, reportsKeys } from '@/api/use-reports';
import { useScopedApi } from '@/api/use-scoped-api';
import { useReportingPeriod } from '@/api/use-performance';
import { useChartColors } from '@/hooks/use-chart-colors';
import { usePrivacy } from '@/context/privacy-context';
import {
  computeYoYDelta,
  formatPeakLabel,
  computeAverageDelta,
} from './IncomeHero.utils';
import type { Payment, PaymentGroup, PaymentsResponse } from '@/api/types';

type AmountMode = 'gross' | 'net';

function pickPaymentAmount(p: Payment, mode: AmountMode): number {
  return parseFloat(mode === 'gross' ? p.grossAmount : p.netAmount);
}

function findPeakBucket(groups: PaymentGroup[], mode: AmountMode) {
  let peak: { bucket: string; total: number } | null = null;
  for (const g of groups) {
    const total = parseFloat(mode === 'gross' ? g.totalGross : g.totalNet);
    if (peak === null || total > peak.total) peak = { bucket: g.bucket, total };
  }
  return peak;
}

function findTopSecurity(groups: PaymentGroup[], mode: AmountMode) {
  const totals = new Map<string, number>();
  let securityGrand = 0;
  for (const g of groups) {
    for (const p of g.payments) {
      if (!p.securityName) continue;
      const v = pickPaymentAmount(p, mode);
      totals.set(p.securityName, (totals.get(p.securityName) ?? 0) + v);
      securityGrand += v;
    }
  }
  if (securityGrand <= 0) return null;
  let top: { name: string; total: number } | null = null;
  for (const [name, total] of totals) {
    if (top === null || total > top.total) top = { name, total };
  }
  if (top === null) return null;
  return { ...top, share: top.total / securityGrand };
}

function countPayments(groups: PaymentGroup[]): number {
  let n = 0;
  for (const g of groups) n += g.count;
  return n;
}

interface IncomeHeroProps {
  amountMode: AmountMode;
}

export function IncomeHero({ amountMode }: IncomeHeroProps) {
  const { t } = useTranslation('reports');
  const { periodStart, periodEnd } = useReportingPeriod();
  const { data, isLoading } = usePayments('month');
  const { dividend, interest } = useChartColors();
  const { isPrivate } = usePrivacy();
  const api = useScopedApi();

  // Prior-year query: shift periodStart/periodEnd back by 1 year.
  const priorStart = format(subYears(parseISO(periodStart), 1), 'yyyy-MM-dd');
  const priorEnd = format(subYears(parseISO(periodEnd), 1), 'yyyy-MM-dd');
  const priorQuery = useQuery({
    queryKey: reportsKeys.payments(api.portfolioId, priorStart, priorEnd, 'month'),
    queryFn: () =>
      api.fetch<PaymentsResponse>(
        `/api/reports/payments?periodStart=${priorStart}&periodEnd=${priorEnd}&groupBy=month`,
      ),
    placeholderData: keepPreviousData,
  });

  const monthsShort = t('returnsHeatmap.months', { returnObjects: true }) as string[];

  const derived = useMemo(() => {
    if (!data) return null;
    const totalEarnings = parseFloat(
      amountMode === 'gross' ? data.totals.earningsGross : data.totals.earningsNet,
    );
    const div = parseFloat(amountMode === 'gross' ? data.totals.dividendsGross : data.totals.dividendsNet);
    const intAmt = parseFloat(amountMode === 'gross' ? data.totals.interestGross : data.totals.interestNet);

    const start = parseISO(periodStart);
    const end = parseISO(periodEnd);
    const months = Math.max(1, differenceInCalendarMonths(end, start) + 1);
    const avgMonth = totalEarnings / months;

    const peak = findPeakBucket(data.combinedGroups, amountMode);
    const topSecurity = findTopSecurity(data.combinedGroups, amountMode);
    const payments = countPayments(data.combinedGroups);

    return { totalEarnings, div, intAmt, avgMonth, peak, topSecurity, payments, months };
  }, [data, amountMode, periodStart, periodEnd]);

  const priorDerived = useMemo(() => {
    if (!priorQuery.data) return null;
    const total = parseFloat(amountMode === 'gross' ? priorQuery.data.totals.earningsGross : priorQuery.data.totals.earningsNet);
    if (total <= 0) return null;
    const start = parseISO(priorStart);
    const end = parseISO(priorEnd);
    const months = Math.max(1, differenceInCalendarMonths(end, start) + 1);
    const peak = findPeakBucket(priorQuery.data.combinedGroups, amountMode);
    const payments = countPayments(priorQuery.data.combinedGroups);
    return { total, months, peak, payments };
  }, [priorQuery.data, amountMode, priorStart, priorEnd]);

  if (isLoading) return <ChartSkeleton height={140} />;
  if (!derived || derived.totalEarnings <= 0) return null;

  const { totalEarnings, div, intAmt, avgMonth, peak, topSecurity, payments, months } = derived;
  const divShare = totalEarnings > 0 ? div / totalEarnings : 0;
  const intShare = totalEarnings > 0 ? intAmt / totalEarnings : 0;

  const yoy = computeYoYDelta(totalEarnings, priorDerived?.total ?? null);
  const avgDelta = computeAverageDelta(
    totalEarnings,
    months,
    priorDerived?.total ?? null,
    priorDerived?.months ?? 0,
  );
  const paymentsDelta = priorDerived ? payments - priorDerived.payments : null;
  const priorYearLabel = format(parseISO(priorEnd), 'yyyy');

  return (
    <Card className="rounded-md">
      <CardContent className="pt-6 pb-5">
        <div className="qv-eyebrow mb-3">
          {amountMode === 'gross' ? t('payments.hero.titleGross') : t('payments.hero.titleNet')}
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:gap-10">
          <div className="flex-shrink-0">
            <div className="qv-numeric text-3xl md:text-4xl font-medium text-[var(--qv-text-display)] leading-none">
              <CurrencyDisplay value={totalEarnings} animated={false} />
            </div>
            {yoy && (
              <div
                className={`mt-2 text-xs qv-numeric ${yoy.isUp ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]'}`}
              >
                {yoy.isUp ? '▲' : '▼'} {Math.abs(yoy.delta * 100).toFixed(1)}% vs{' '}
                <CurrencyDisplay value={yoy.priorTotal} className="qv-numeric" animated={false} />{' '}
                {t('payments.yoy.priorYearLabel', { year: priorYearLabel })}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div
              className="flex h-3.5 w-full overflow-hidden rounded-sm border border-[var(--qv-border-subtle)]"
              role="img"
              aria-label={`${t('payments.dividends')} ${Math.round(divShare * 100)}%, ${t('payments.interest')} ${Math.round(intShare * 100)}%`}
              style={{
                filter: isPrivate ? 'blur(6px) saturate(0)' : 'none',
                transition: 'filter 0.2s ease',
              }}
            >
              <div style={{ width: `${(divShare * 100).toFixed(2)}%`, backgroundColor: dividend }} />
              <div style={{ width: `${(intShare * 100).toFixed(2)}%`, backgroundColor: interest }} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-[var(--qv-text-secondary)]">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: dividend }} />
                <span>
                  {t('payments.dividends')}{' '}
                  <CurrencyDisplay value={div} className="qv-numeric text-foreground font-medium" />{' '}
                  <span className="qv-numeric text-[var(--qv-text-muted)]">{Math.round(divShare * 100)}%</span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: interest }} />
                <span>
                  {t('payments.interest')}{' '}
                  <CurrencyDisplay value={intAmt} className="qv-numeric text-foreground font-medium" />{' '}
                  <span className="qv-numeric text-[var(--qv-text-muted)]">{Math.round(intShare * 100)}%</span>
                </span>
              </span>
            </div>
          </div>
        </div>

        <Separator className="my-4 bg-[var(--qv-border-subtle)]" />

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <HeroCell label={t('payments.hero.avgMonth')}>
            <CurrencyDisplay value={avgMonth} className="qv-numeric text-base font-medium" animated={false} />
            {avgDelta && (
              <div className={`text-xs qv-numeric ${avgDelta.isUp ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]'}`}>
                {avgDelta.isUp ? '▲ +' : '▼ '}
                <CurrencyDisplay value={Math.abs(avgDelta.delta)} className="qv-numeric" animated={false} />/mo
              </div>
            )}
          </HeroCell>

          <HeroCell label={t('payments.hero.peakMonth')}>
            {peak ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground whitespace-nowrap">
                    {formatPeakLabel(peak.bucket, monthsShort)}
                  </span>
                  <CurrencyDisplay value={peak.total} className="qv-numeric text-xs text-[var(--qv-text-muted)]" animated={false} />
                </div>
                {priorDerived?.peak && (
                  <div className="text-xs text-[var(--qv-text-muted)] qv-numeric mt-0.5 flex items-baseline gap-1.5">
                    <span>{t('payments.hero.priorPeak', { defaultValue: 'prior peak' })}:</span>
                    <span>{formatPeakLabel(priorDerived.peak.bucket, monthsShort)}</span>
                    <CurrencyDisplay value={priorDerived.peak.total} className="qv-numeric" animated={false} />
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </HeroCell>

          <HeroCell label={t('payments.hero.payments')}>
            <span className="qv-numeric text-base font-medium">{payments}</span>
            {paymentsDelta !== null && paymentsDelta !== 0 && (
              <div className={`text-xs qv-numeric ${paymentsDelta > 0 ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]'}`}>
                {paymentsDelta > 0 ? '+' : ''}{paymentsDelta} vs {(priorDerived?.payments ?? 0)}
              </div>
            )}
          </HeroCell>

          <HeroCell label={t('payments.hero.topSecurity')}>
            {topSecurity ? (
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground" title={topSecurity.name}>
                  {topSecurity.name}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <CurrencyDisplay value={topSecurity.total} className="qv-numeric text-xs text-[var(--qv-text-muted)]" animated={false} />
                  <span className="qv-numeric text-xs text-[var(--qv-text-muted)]">
                    ({Math.round(topSecurity.share * 100)}%)
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </HeroCell>
        </div>
      </CardContent>
    </Card>
  );
}

function HeroCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="qv-eyebrow mb-1">{label}</div>
      {children}
    </div>
  );
}
