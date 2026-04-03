import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { useAccounts, accountsKeys } from '@/api/use-accounts';
import { apiFetch } from '@/api/fetch';
import type { AccountHoldingsResponse } from '@/api/types';
import { AccountSummaryStrip } from '@/components/domain/AccountSummaryStrip';
import { BrokerageUnitCard } from '@/components/domain/BrokerageUnitCard';
import { StandaloneDepositCard } from '@/components/domain/StandaloneDepositCard';
import { CreateAccountDialog } from '@/components/domain/CreateAccountDialog';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export default function AccountsHub() {
  const { t } = useTranslation('accounts');

  // 1. State
  const [showRetired, setShowRetired] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

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

          <div className="flex items-center gap-2">
            <Checkbox
              checked={showRetired}
              onCheckedChange={(checked) => setShowRetired(!!checked)}
            />
            <span className="text-sm text-muted-foreground">{t('retired.show')}</span>
          </div>

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

      <CreateAccountDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}
