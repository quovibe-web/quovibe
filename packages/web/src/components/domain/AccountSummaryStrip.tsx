import { useTranslation } from 'react-i18next';
import { SummaryStrip } from '@/components/shared/SummaryStrip';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { CashBreakdown } from '@/components/shared/CashBreakdown';
import { MetricCardSkeleton } from '@/components/shared/MetricCardSkeleton';
import { useAccounts } from '@/api/use-accounts';
import { useStatementOfAssets } from '@/api/use-reports';

export function AccountSummaryStrip() {
  const { t } = useTranslation('accounts');

  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(false);
  const { data: statement, isLoading: statementLoading } = useStatementOfAssets();

  const isLoading = accountsLoading || statementLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <MetricCardSkeleton key={i} index={i} />
        ))}
      </div>
    );
  }

  const totalAccounts = accounts.length; // native-ok
  const cashValue = parseFloat(statement?.totals.cashValue ?? '0');
  const cashByCurrency = statement?.totals.cashByCurrency ?? [];

  return (
    <SummaryStrip
      columns={2}
      items={[
        {
          label: t('summary.totalAccounts'),
          value: (
            <span className="text-2xl font-semibold tabular-nums">{totalAccounts}</span>
          ),
        },
        {
          label: t('summary.cash'),
          value: (
            <div>
              <CurrencyDisplay
                value={cashValue}
                className="text-2xl font-semibold tabular-nums"
              />
              <CashBreakdown cashByCurrency={cashByCurrency} className="mt-1" />
            </div>
          ),
        },
      ]}
    />
  );
}
