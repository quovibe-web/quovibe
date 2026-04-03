import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';

import type { BrokerageUnit } from '@/api/types';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { usePrivacy } from '@/context/privacy-context';

interface BrokerageUnitExpandedProps {
  unit: BrokerageUnit;
}

export function BrokerageUnitExpanded({ unit }: BrokerageUnitExpandedProps) {
  const { t } = useTranslation('accounts');
  const { isPrivate } = usePrivacy();
  const location = useLocation();
  const periodSearch = location.search;

  const { portfolio, deposit } = unit;

  const cashValue = parseFloat(deposit?.balance ?? '0');
  const cashRatio = (() => {
    const secValue = parseFloat(portfolio.balance);
    const grandTotal = secValue + cashValue;
    return grandTotal > 0 ? (cashValue / grandTotal * 100).toFixed(1) : '0.0'; // native-ok
  })();
  const currency = portfolio.currency ?? deposit?.currency ?? 'EUR';

  return (
    <div className="space-y-3">
      {/* Cash account details */}
      {deposit && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">
              {deposit.name ?? t('expanded.cash')}
            </p>
            <CurrencyDisplay
              value={cashValue}
              currency={deposit.currency ?? currency}
              className="text-xs font-semibold tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('detail.currency')}</span>
              <span>{deposit.currency}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('expanded.transactions')}</span>
              <span>{deposit.transactionCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('expanded.cashRatio')}</span>
              <span>{isPrivate ? '••••' : `${cashRatio}%`}</span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation links */}
      <div className="flex gap-2">
        <Link
          to={`/investments${periodSearch ? periodSearch + '&' : '?'}account=${portfolio.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg border border-border transition-colors"
        >
          <TrendingUp className="h-4 w-4" />
          {t('expanded.viewHoldings')} →
        </Link>
        <Link
          to={`/accounts/${portfolio.id}${periodSearch}`}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 flex items-center justify-center py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg border border-border transition-colors"
        >
          {t('card.viewDetails')} →
        </Link>
      </div>
    </div>
  );
}
