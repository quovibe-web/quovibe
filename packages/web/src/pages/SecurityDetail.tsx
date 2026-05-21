import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavTitle } from '@/hooks/useNavTitle';
import type { ColumnDef } from '@tanstack/react-table';
import { parseISO, isAfter, isBefore, startOfDay } from 'date-fns';
import { TrendingUp, ListX, ArrowLeft, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/DataTable';
import { dateColumnMeta, textColumnMeta, currencyColumnMeta, sharesColumnMeta } from '@/lib/column-factories';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { CurrencyDisplayWithToggle } from '@/components/shared/CurrencyDisplayWithToggle';
import { ForexViewChip } from '@/components/shared/ForexViewChip';
import { EmptyState } from '@/components/shared/EmptyState';
import { useSecurityDetail, useFetchPrices } from '@/api/use-securities';
import { SecurityEditor, type EditorSection } from '@/components/domain/SecurityEditor';
import { PriceChart } from '@/components/domain/PriceChart';
import { useTransactions } from '@/api/use-transactions';
import { usePerformanceSecurities, useReportingPeriod } from '@/api/use-performance';
import type { TransactionListItem } from '@/api/types';
import { formatDate } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { SharesDisplay } from '@/components/shared/SharesDisplay';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { ChartSkeleton } from '@/components/shared/ChartSkeleton';
import { TaxonomyAssignmentsCard } from '@/components/domain/SecurityDetail/TaxonomyAssignmentsCard';
import { cn } from '@/lib/utils';
import { getTransactionCashflowSign } from '@/lib/transaction-display';
import { TypeBadge } from '@/components/shared/TypeBadge';
import { SignedPercent } from '@/components/shared/SignedPercent';
import { SecurityAvatar } from '@/components/shared/SecurityAvatar';

function SharesCell({ value }: { value: string | null }) {
  const { isPrivate } = usePrivacy();
  if (!value) return <>—</>;
  return <>{isPrivate ? '•••' : value}</>;
}

const MARKER_TYPES = new Set(['BUY', 'SELL', 'DIVIDEND', 'DIVIDENDS']);

interface PerfMetricProps {
  label: string;
  value: string | null;
  type: 'pct' | 'currency';
  currency?: string;
  isPrivate: boolean;
  converged?: boolean;
  notConvergedLabel?: string;
  /** Base-currency value for toggle (currency type only). */
  baseValue?: string | null;
  /** Base currency code for toggle (currency type only). */
  baseCurrency?: string;
}

function PerfMetric({ label, value, type, currency, isPrivate, converged, notConvergedLabel, baseValue, baseCurrency }: PerfMetricProps) {
  if (isPrivate) {
    return (
      <div>
        <p className="qv-eyebrow mb-0.5">{label}</p>
        <p className="qv-numeric text-base font-medium">••••••</p>
      </div>
    );
  }
  if (value === null || converged === false) {
    return (
      <div>
        <p className="qv-eyebrow mb-0.5">{label}</p>
        <p className="qv-numeric text-base font-medium text-[var(--qv-warning)]">{notConvergedLabel ?? '—'}</p>
      </div>
    );
  }
  const num = parseFloat(value);
  if (type === 'pct') {
    return (
      <div>
        <p className="qv-eyebrow mb-0.5">{label}</p>
        <SignedPercent value={num} className="text-base" />
      </div>
    );
  }
  if (baseValue != null && baseCurrency != null) {
    return (
      <div>
        <p className="qv-eyebrow mb-0.5">{label}</p>
        <CurrencyDisplayWithToggle
          value={parseFloat(baseValue)}
          currency={baseCurrency}
          nativeValue={num}
          nativeCurrency={currency}
          forexSurface="securityDetail"
          className="qv-numeric text-base font-medium"
        />
      </div>
    );
  }
  return (
    <div>
      <p className="qv-eyebrow mb-0.5">{label}</p>
      <CurrencyDisplay value={num} currency={currency} className="qv-numeric text-base font-medium" />
    </div>
  );
}

export default function SecurityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('securities');
  const { t: tCommon } = useTranslation('common');
  useNavTitle('security');
  const { t: tTx } = useTranslation('transactions');
  const { isPrivate } = usePrivacy();
  const { data: security, isLoading, isFetching } = useSecurityDetail(id ?? '');
  const fetchPrices = useFetchPrices(id ?? '');
  const { data: perfData } = usePerformanceSecurities();
  const { data: txPage, isLoading: txLoading } = useTransactions({ security: id }, 1, 9999);
  const transactions = (txPage?.data ?? []) as TransactionListItem[];
  // Range selector removed — PriceChart uses the global reporting period
  const [editOpen, setEditOpen] = useState(false);
  const [editSection, setEditSection] = useState<EditorSection | undefined>(undefined);

  function openEditor(section?: EditorSection) {
    setEditSection(section);
    setEditOpen(true);
  }

  // Find this security's performance data from the portfolio-wide query (cached from Investments page)
  const perf = useMemo(() => {
    if (!perfData || !id) return null;
    return perfData.find(p => p.securityId === id) ?? null;
  }, [perfData, id]);

  const txColumns = useMemo<ColumnDef<TransactionListItem>[]>(() => [
    { accessorKey: 'date', ...dateColumnMeta(), header: tTx('columns.date'), cell: ({ getValue }) => formatDate(getValue<string>()) },
    {
      accessorKey: 'type',
      ...textColumnMeta(),
      header: tTx('columns.type'),
      cell: ({ row }) => (
        <TypeBadge type={row.original.type} direction={row.original.direction} />
      ),
    },
    {
      accessorKey: 'amount',
      ...currencyColumnMeta(),
      header: tTx('columns.amount'),
      cell: ({ row }) => {
        const v = row.original.amount;
        if (!v) return '—';
        const absValue = Math.abs(parseFloat(v));
        const sign = getTransactionCashflowSign(row.original.type, row.original.direction, 'securities');
        return (
          <CurrencyDisplay
            value={absValue}
            currency={row.original.currencyCode}
            colorize={sign !== 0}
            colorSign={sign !== 0 ? sign : undefined}
          />
        );
      },
    },
    {
      accessorKey: 'shares',
      ...sharesColumnMeta(),
      header: tTx('columns.shares'),
      cell: ({ getValue }) => <SharesCell value={getValue<string | null>()} />,
    },
  ], [tTx]);

  const isRefetching = isFetching && !isLoading;
  const { periodStart, periodEnd } = useReportingPeriod();

  // Filter prices and transactions to the global reporting period
  const allPrices = useMemo(() => {
    const prices = security?.prices ?? [];
    if (!periodStart && !periodEnd) return prices;
    const start = periodStart ? startOfDay(parseISO(periodStart)) : null;
    const end = periodEnd ? startOfDay(parseISO(periodEnd)) : null;
    return prices.filter(p => {
      const d = parseISO(p.date);
      if (start && isBefore(d, start)) return false;
      if (end && isAfter(d, end)) return false;
      return true;
    });
  }, [security?.prices, periodStart, periodEnd]);

  const txMarkers = (transactions as TransactionListItem[])
    .filter(tx => MARKER_TYPES.has(tx.type))
    .map(tx => ({
      date: tx.date.slice(0, 10),
      type: (tx.type === 'DIVIDENDS' ? 'DIVIDEND' : tx.type) as 'BUY' | 'SELL' | 'DIVIDEND',
      amount: tx.amount ? parseFloat(tx.amount) : undefined,
      currency: tx.currencyCode ?? (tx as { currency?: string }).currency ?? undefined,
    }));

  return (
    <div className={cn("qv-page space-y-6", isRefetching && 'opacity-60 transition-opacity duration-200')}>
    {isLoading ? (
      <>
        <SectionSkeleton rows={4} />
        <ChartSkeleton height={280} />
        <Card>
          <CardHeader><CardTitle className="text-base">{t('detail.transactions')}</CardTitle></CardHeader>
          <CardContent>
            <DataTable columns={txColumns} data={[]} isLoading skeletonRows={5} />
          </CardContent>
        </Card>
      </>
    ) : !security ? (
      <p className="text-muted-foreground">{tCommon('notFound')}</p>
    ) : (
      <>
      {/* Back button */}
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
        {t('detail.back')}
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <SecurityAvatar name={security.name} logoUrl={security.logoUrl} size="md" />
          <div>
            <h1
              className="font-display text-3xl md:text-4xl text-[var(--qv-text-display)]"
              style={{ fontVariationSettings: '"opsz" 144', fontWeight: 500, letterSpacing: '-0.02em' }}
            >
              {security.name}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {security.ticker && (
                <span className="qv-numeric text-xs font-medium px-1.5 py-0.5 rounded-sm bg-[var(--qv-surface-3)] text-foreground">
                  {security.ticker}
                </span>
              )}
              {security.isin && (
                <span className="qv-numeric text-sm text-muted-foreground">{security.isin}</span>
              )}
              {security.currency && (
                <span className="text-sm text-muted-foreground">{security.currency}</span>
              )}
            </div>
          </div>
        </div>
        <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
          {perf && (
            <ForexViewChip
              surface="securityDetail"
              baseCurrency={perf.baseCurrency}
              nativeCurrencies={[perf.currency]}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={fetchPrices.isPending || !id}
            onClick={() => fetchPrices.mutate('merge')}
          >
            <RefreshCw className={cn('h-4 w-4', fetchPrices.isPending && 'animate-spin')} />
            {fetchPrices.isPending ? t('actions.refreshing') : t('actions.refreshQuote')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => openEditor()}>{tCommon('edit')}</Button>
        </div>
      </div>

      {/* Hero metrics: Market Value + Unrealized P&L */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-[var(--qv-surface-elevated)] border-[var(--qv-border-subtle)]">
          <CardContent className="pt-5 pb-4">
            <p className="qv-eyebrow mb-1">{t('detail.marketValue')}</p>
            {perf ? (
              <>
                <CurrencyDisplayWithToggle
                  value={parseFloat(perf.marketValueBase)}
                  currency={perf.baseCurrency}
                  nativeValue={parseFloat(perf.mve)}
                  nativeCurrency={perf.currency}
                  forexSurface="securityDetail"
                  className="qv-numeric text-2xl font-medium"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  <SharesDisplay value={security.shares} className="qv-numeric" /> × <CurrencyDisplay value={security.latestPrice ? parseFloat(security.latestPrice) : 0} currency={security.currency} className="qv-numeric" />
                </p>
              </>
            ) : (
              <span className="qv-numeric text-2xl font-medium text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>
        <Card className="bg-[var(--qv-surface-elevated)] border-[var(--qv-border-subtle)]">
          <CardContent className="pt-5 pb-4">
            <p className="qv-eyebrow mb-1">{t('detail.unrealizedPL')}</p>
            {perf ? (
              <>
                <CurrencyDisplayWithToggle
                  value={parseFloat(perf.unrealizedBase)}
                  currency={perf.baseCurrency}
                  nativeValue={parseFloat(perf.unrealizedGain)}
                  nativeCurrency={perf.currency}
                  forexSurface="securityDetail"
                  colorize
                  className="qv-numeric text-2xl font-medium"
                />
                {parseFloat(perf.purchaseValue) > 0 && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs">
                    <SignedPercent
                      value={parseFloat(perf.unrealizedGain) / parseFloat(perf.purchaseValue)}
                      className="text-xs"
                    />
                    <span className="text-muted-foreground">{t('detail.fromPurchase')}</span>
                  </p>
                )}
              </>
            ) : (
              <span className="qv-numeric text-2xl font-medium text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Taxonomies — classification surfaced read-only here, edit via the Editor modal */}
      <TaxonomyAssignmentsCard
        assignments={security.taxonomyAssignments ?? []}
        onClassify={() => openEditor('taxonomies')}
      />

      {/* Performance card */}
      {perf && (
        <Card style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '120ms' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('detail.performance')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-x-8 gap-y-4">
              <PerfMetric label={t('detail.perfMetrics.ttwror')} value={perf.ttwror} type="pct" isPrivate={isPrivate} />
              <PerfMetric label={t('detail.perfMetrics.ttwrorPa')} value={perf.ttwrorPa} type="pct" isPrivate={isPrivate} />
              <PerfMetric label={t('detail.perfMetrics.irr')} value={perf.irr} type="pct" isPrivate={isPrivate} converged={perf.irrConverged} notConvergedLabel={t('detail.perfMetrics.notConverged')} />
              <PerfMetric label={t('detail.perfMetrics.realizedGain')} value={perf.realizedGain} type="currency" currency={security.currency} isPrivate={isPrivate} baseValue={perf.realizedBase} baseCurrency={perf.baseCurrency} />
              <PerfMetric label={t('detail.perfMetrics.dividends')} value={perf.dividends} type="currency" currency={security.currency} isPrivate={isPrivate} baseValue={perf.dividendsBase} baseCurrency={perf.baseCurrency} />
              <PerfMetric label={t('detail.perfMetrics.fees')} value={perf.fees} type="currency" currency={security.currency} isPrivate={isPrivate} />
              <PerfMetric label={t('detail.perfMetrics.taxes')} value={perf.taxes} type="currency" currency={security.currency} isPrivate={isPrivate} />
              <PerfMetric label={t('detail.perfMetrics.purchaseValue')} value={perf.purchaseValue} type="currency" currency={security.currency} isPrivate={isPrivate} baseValue={perf.costBase} baseCurrency={perf.baseCurrency} />
              <PerfMetric label={t('detail.perfMetrics.mve')} value={perf.mve} type="currency" currency={security.currency} isPrivate={isPrivate} baseValue={perf.marketValueBase} baseCurrency={perf.baseCurrency} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '180ms' }}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">{t('detail.priceHistory')}</CardTitle>
          {allPrices.length > 0 && (
            <div id="price-chart-toolbar" />
          )}
        </CardHeader>
        <CardContent>
          {allPrices.length > 0 ? (
            <PriceChart prices={allPrices} transactions={txMarkers} toolbarPortalId="price-chart-toolbar" />
          ) : (
            <div>
              <EmptyState icon={TrendingUp} title={t('detail.noPrices')} />
              <div className="text-center -mt-2">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => openEditor('priceFeed')}
                >
                  {t('detail.configureFeed')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '240ms' }}>
        <CardHeader>
          <CardTitle className="text-base">{t('detail.transactions')}</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 && !txLoading ? (
            <EmptyState icon={ListX} title={t('detail.noTransactions')} />
          ) : (
            <DataTable columns={txColumns} data={transactions as TransactionListItem[]} pagination pageSize={15} isLoading={txLoading} skeletonRows={5} tableId="security-transactions" defaultSorting={[{ id: 'date', desc: true }]} />
          )}
        </CardContent>
      </Card>
      <SecurityEditor
        mode="edit"
        securityId={id}
        open={editOpen}
        onOpenChange={(open) => { if (!open) { setEditOpen(false); setEditSection(undefined); } }}
        initialSection={editSection}
      />
      </>
    )}
    </div>
  );
}
