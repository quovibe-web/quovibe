import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Download, Landmark } from 'lucide-react';
import { CostMethod } from '@quovibe/shared';
import type { CalculationBreakdownResponse } from '@quovibe/shared';
import { useAccounts, accountsKeys } from '@/api/use-accounts';
import { useScopedApi } from '@/api/use-scoped-api';
import type { AccountHoldingsResponse } from '@/api/types';
import { useReportingPeriod, performanceKeys } from '@/api/use-performance';
import { AccountSummaryStrip } from '@/components/domain/AccountSummaryStrip';
import { BrokerageUnitCard } from '@/components/domain/BrokerageUnitCard';
import { StandaloneDepositCard } from '@/components/domain/StandaloneDepositCard';
import { CreateAccountDialog } from '@/components/domain/CreateAccountDialog';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { SignedPercent } from '@/components/shared/SignedPercent';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePrivacy } from '@/context/privacy-context';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { useNavTitle } from '@/hooks/useNavTitle';
import { buildAccountsCsv, downloadAccountsCsv } from '@/lib/accounts-export';

export default function AccountsHub() {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  useNavTitle('accounts');

  // 1. State
  const [showRetired, setShowRetired] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'summary'>('cards');
  const navigate = useNavigate();
  const { isPrivate } = usePrivacy();
  const baseCurrency = useBaseCurrency();
  const { periodStart, periodEnd } = useReportingPeriod();
  const api = useScopedApi();

  // 2. Fetch accounts
  const { data: accounts = [], isLoading } = useAccounts(showRetired);

  // 3. Derive portfolios BEFORE useQueries (rules of hooks)
  const portfolios = useMemo(() => accounts.filter(a => a.type === 'portfolio'), [accounts]);

  // 4. Prefetch holdings and performance for all portfolios
  const holdingsQueries = useQueries({
    queries: portfolios.map(p => ({
      queryKey: accountsKeys.holdings(api.portfolioId, p.id),
      queryFn: () => api.fetch<AccountHoldingsResponse>(`/api/accounts/${p.id}/holdings`),
    })),
  });

  const perfQueries = useQueries({
    queries: portfolios.map(p => ({
      queryKey: performanceKeys.calculation(api.portfolioId, periodStart, periodEnd, true, CostMethod.MOVING_AVERAGE, p.id, true),
      queryFn: () => {
        const params = new URLSearchParams({
          periodStart,
          periodEnd,
          preTax: 'true',
          costMethod: CostMethod.MOVING_AVERAGE,
          filter: p.id,
          withReference: 'true',
        });
        return api.fetch<CalculationBreakdownResponse>(`/api/performance/calculation?${params}`);
      },
    })),
  });

  // 5. Build holdingsMap and perfMap
  const holdingsMap = useMemo(() => {
    const map = new Map<string, AccountHoldingsResponse>();
    portfolios.forEach((p, i) => {
      if (holdingsQueries[i]?.data) map.set(p.id, holdingsQueries[i].data!);
    });
    return map;
  }, [portfolios, holdingsQueries]);

  const perfMap = useMemo(() => {
    const map = new Map<string, CalculationBreakdownResponse>();
    portfolios.forEach((p, i) => {
      if (perfQueries[i]?.data) map.set(p.id, perfQueries[i].data!);
    });
    return map;
  }, [portfolios, perfQueries]);

  // 6. Export CSV
  const handleExportCsv = () => {
    const csv = buildAccountsCsv(
      accounts,
      {
        name: t('columns.name'),
        type: t('columns.type'),
        currency: t('columns.currency'),
        balance: t('columns.balance'),
        transactionCount: t('columns.transactionCount'),
      },
      {
        portfolio: t('types.portfolio'),
        deposit: t('types.deposit'),
      },
    );
    const date = new Date().toISOString().slice(0, 10); // native-ok — date index
    downloadAccountsCsv(csv, `accounts_${date}`);
  };

  // 7. Compute brokerageUnits and standaloneDeposits
  const { brokerageUnits, standaloneDeposits } = useMemo(() => {
    const deposits = accounts.filter(a => a.type === 'account');
    const linkedDepositIds = new Set<string>();

    const units = portfolios.map(p => {
      const deposit = deposits.find(d => d.id === p.referenceAccountId) ?? null;
      if (deposit) linkedDepositIds.add(deposit.id);
      return { portfolio: p, deposit, holdings: holdingsMap.get(p.id) ?? null };
    });

    const standalone = deposits.filter(d => !linkedDepositIds.has(d.id));
    return { brokerageUnits: units, standaloneDeposits: standalone };
  }, [accounts, portfolios, holdingsMap]);

  return (
    <div className="qv-page space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('hub.subtitle')}
        actions={!isLoading && accounts.length > 0
          ? (
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={isPrivate}
                      onClick={handleExportCsv}
                    >
                      <Download className="h-4 w-4" />
                      {tCommon('exportCsv')}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {isPrivate ? tCommon('exportDisabledPrivacy') : tCommon('exportCsv')}
                </TooltipContent>
              </Tooltip>
              <Button onClick={() => setCreateDialogOpen(true)}>{t('actions.newAccount')}</Button>
            </div>
          )
          : undefined}
      />

      {isLoading ? (
        <SectionSkeleton rows={3} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={t('title')}
          description={t('hub.subtitle')}
          action={<Button onClick={() => setCreateDialogOpen(true)}>{t('actions.newAccount')}</Button>}
        />
      ) : (
        <>
          <AccountSummaryStrip />

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={showRetired}
                onCheckedChange={(checked) => setShowRetired(!!checked)}
              />
              <span className="text-sm text-muted-foreground">{t('retired.show')}</span>
            </div>
            <SegmentedControl
              segments={[
                { value: 'cards', label: t('viewMode.cards') },
                { value: 'summary', label: t('viewMode.summary') },
              ]}
              value={viewMode}
              onChange={setViewMode}
              size="sm"
            />
          </div>

          {viewMode === 'cards' && (
            <>
              {brokerageUnits.length > 0 && (
                <div className="flex items-center gap-3 max-w-[720px]">
                  <div className="flex-1 h-px bg-[var(--qv-border-subtle)]" />
                  <span className="qv-eyebrow">
                    {t('brokerage.title')}
                  </span>
                  <div className="flex-1 h-px bg-[var(--qv-border-subtle)]" />
                </div>
              )}

              <div className="max-w-[720px] space-y-3.5">
                {brokerageUnits.map(unit => (
                  <BrokerageUnitCard
                    key={unit.portfolio.id}
                    unit={unit}
                    isExpanded={expandedId === unit.portfolio.id}
                    onExpand={() => setExpandedId(prev => prev === unit.portfolio.id ? null : unit.portfolio.id)}
                    perf={perfMap.get(unit.portfolio.id)}
                  />
                ))}
              </div>

              {standaloneDeposits.length > 0 && (
                <>
                  <div className="flex items-center gap-3 max-w-[720px]">
                    <div className="flex-1 h-px bg-[var(--qv-border-subtle)]" />
                    <span className="qv-eyebrow">
                      {t('standalone.title')}
                    </span>
                    <div className="flex-1 h-px bg-[var(--qv-border-subtle)]" />
                  </div>
                  <div className="max-w-[720px] space-y-3.5">
                    {standaloneDeposits.map(d => (
                      <StandaloneDepositCard key={d.id} account={d} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {viewMode === 'summary' && (
            <div className="max-w-[720px] space-y-4">
              {brokerageUnits.length > 0 && (
                <div className="rounded-md border border-border bg-card overflow-hidden">
                  <div className="px-4 py-2 bg-[var(--qv-surface-elevated)] border-b border-[var(--qv-border-subtle)]">
                    <p className="qv-eyebrow">{t('brokerage.title')}</p>
                  </div>
                  <div className="divide-y divide-[var(--qv-border-subtle)]">
                    {brokerageUnits.map(unit => {
                      const holdings = unit.holdings;
                      const mv = holdings ? parseFloat(holdings.totalValue ?? '0') : 0;
                      const perf = perfMap.get(unit.portfolio.id);
                      const perfPct = perf ? parseFloat(perf.openPositionPnL.percentage) : null;
                      const absPerf = perf ? parseFloat(perf.openPositionPnL.value) : null;
                      const isPositive = absPerf !== null ? absPerf >= 0 : true;

                      return (
                        <button
                          key={unit.portfolio.id}
                          onClick={() => navigate(`/p/${api.portfolioId}/accounts/${unit.portfolio.id}`)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--qv-surface-3)] transition-colors text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{unit.portfolio.name}</div>
                            {unit.deposit && (
                              <div className="text-xs text-muted-foreground truncate">{unit.deposit.name}</div>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <CurrencyDisplay value={mv} className="qv-numeric text-sm" />
                            {!isPrivate && perf && (
                              <div className="flex items-center justify-end gap-1.5 text-xs">
                                <SignedPercent value={perfPct} />
                                {absPerf !== null && (
                                  <CurrencyDisplay
                                    value={absPerf}
                                    currency={baseCurrency}
                                    colorize
                                    colorSign={isPositive ? 1 : -1}
                                    className="qv-numeric opacity-70"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {standaloneDeposits.length > 0 && (
                <div className="rounded-md border border-border bg-card overflow-hidden">
                  <div className="px-4 py-2 bg-[var(--qv-surface-elevated)] border-b border-[var(--qv-border-subtle)]">
                    <p className="qv-eyebrow">{t('standalone.title')}</p>
                  </div>
                  <div className="divide-y divide-[var(--qv-border-subtle)]">
                    {standaloneDeposits.map(d => (
                      <button
                        key={d.id}
                        onClick={() => navigate(`/p/${api.portfolioId}/accounts/${d.id}`)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--qv-surface-3)] transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{d.name}</div>
                        </div>
                        <CurrencyDisplay value={parseFloat(d.balance ?? '0')} colorize className="qv-numeric text-sm" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <CreateAccountDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}
