import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { useAccounts, accountsKeys } from '@/api/use-accounts';
import { apiFetch } from '@/api/fetch';
import type { AccountHoldingsResponse } from '@/api/types';
import { AccountSummaryStrip } from '@/components/domain/AccountSummaryStrip';
import { BrokerageUnitCard } from '@/components/domain/BrokerageUnitCard';
import { StandaloneDepositCard } from '@/components/domain/StandaloneDepositCard';
import { CreateAccountDialog } from '@/components/domain/CreateAccountDialog';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { usePrivacy } from '@/context/privacy-context';
import { formatPercentage } from '@/lib/formatters';

export default function AccountsHub() {
  const { t } = useTranslation('accounts');

  // 1. State
  const [showRetired, setShowRetired] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'summary'>('cards');
  const navigate = useNavigate();
  const { isPrivate } = usePrivacy();

  // 2. Fetch accounts
  const { data: accounts = [], isLoading } = useAccounts(showRetired);

  // 3. Derive portfolios BEFORE useQueries (rules of hooks)
  const portfolios = useMemo(() => accounts.filter(a => a.type === 'portfolio'), [accounts]);

  // 4. Prefetch holdings for all portfolios
  const holdingsQueries = useQueries({
    queries: portfolios.map(p => ({
      queryKey: accountsKeys.holdings(p.id),
      queryFn: () => apiFetch<AccountHoldingsResponse>(`/api/accounts/${p.id}/holdings`),
    })),
  });

  // 5. Build holdingsMap
  const holdingsMap = useMemo(() => {
    const map = new Map<string, AccountHoldingsResponse>();
    portfolios.forEach((p, i) => {
      if (holdingsQueries[i]?.data) map.set(p.id, holdingsQueries[i].data!);
    });
    return map;
  }, [portfolios, holdingsQueries]);

  // 6. Compute brokerageUnits and standaloneDeposits
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
          ? <Button onClick={() => setCreateDialogOpen(true)}>{t('actions.newAccount')}</Button>
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
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground uppercase tracking-widest">
                    {t('brokerage.title')}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}

              <div className="max-w-[720px] space-y-3.5">
                {brokerageUnits.map(unit => (
                  <BrokerageUnitCard
                    key={unit.portfolio.id}
                    unit={unit}
                    isExpanded={expandedId === unit.portfolio.id}
                    onExpand={() => setExpandedId(prev => prev === unit.portfolio.id ? null : unit.portfolio.id)}
                  />
                ))}
              </div>

              {standaloneDeposits.length > 0 && (
                <>
                  <div className="flex items-center gap-3 max-w-[720px]">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground uppercase tracking-widest">
                      {t('standalone.title')}
                    </span>
                    <div className="flex-1 h-px bg-border" />
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
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/50 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t('brokerage.title')}
                  </div>
                  <div className="divide-y divide-border">
                    {brokerageUnits.map(unit => {
                      const holdings = unit.holdings;
                      const mv = holdings ? parseFloat(holdings.totalValue ?? '0') : 0;
                      const gainRaw = holdings
                        ? holdings.holdings.reduce((acc, h) => acc + parseFloat(h.profitLoss ?? '0'), 0)
                        : 0;
                      const costBasis = mv - gainRaw;
                      const gainPct = costBasis > 0 ? gainRaw / costBasis : 0;

                      return (
                        <button
                          key={unit.portfolio.id}
                          onClick={() => navigate(`/accounts/${unit.portfolio.id}`)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{unit.portfolio.name}</div>
                            {unit.deposit && (
                              <div className="text-[10px] text-muted-foreground truncate">{unit.deposit.name}</div>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <CurrencyDisplay value={mv} className="text-sm" />
                            {!isPrivate && (
                              <div className={cn('text-[10px] tabular-nums', gainRaw >= 0 ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]')}>
                                {gainPct !== 0 ? formatPercentage(gainPct) : '—'}
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
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/50 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t('standalone.title')}
                  </div>
                  <div className="divide-y divide-border">
                    {standaloneDeposits.map(d => (
                      <button
                        key={d.id}
                        onClick={() => navigate(`/accounts/${d.id}`)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{d.name}</div>
                        </div>
                        <CurrencyDisplay value={parseFloat(d.balance ?? '0')} className="text-sm" />
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
