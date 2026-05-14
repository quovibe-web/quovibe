import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';

import type { BrokerageUnit } from '@/api/types';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Button } from '@/components/ui/button';
import { usePrivacy } from '@/context/privacy-context';

interface BrokerageUnitExpandedProps {
  unit: BrokerageUnit;
}

export function BrokerageUnitExpanded({ unit }: BrokerageUnitExpandedProps) {
  const { t } = useTranslation('accounts');
  const { isPrivate } = usePrivacy();
  const location = useLocation();
  const { portfolioId } = useParams<{ portfolioId: string }>();
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
            <p className="qv-eyebrow">
              {deposit.name ?? t('expanded.cash')}
            </p>
            <CurrencyDisplay
              value={cashValue}
              currency={deposit.currency ?? currency}
              className="qv-numeric text-xs font-medium"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('detail.currency')}</span>
              <span>{deposit.currency}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('expanded.transactions')}</span>
              <span className="qv-numeric">{deposit.transactionCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('expanded.cashRatio')}</span>
              <span className="qv-numeric">{isPrivate ? '••••' : `${cashRatio}%`}</span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation links */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild className="flex-1">
          <Link
            to={`/p/${portfolioId}/investments${periodSearch ? periodSearch + '&' : '?'}account=${portfolio.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <TrendingUp className="h-4 w-4" />
            {t('expanded.viewHoldings')} →
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild className="flex-1">
          <Link
            to={`/p/${portfolioId}/accounts/${portfolio.id}${periodSearch}`}
            onClick={(e) => e.stopPropagation()}
          >
            {t('card.viewDetails')} →
          </Link>
        </Button>
      </div>
    </div>
  );
}
