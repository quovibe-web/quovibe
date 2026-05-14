import Decimal from 'decimal.js';
import { useAllTimeHigh } from '@/api/use-ath';
import { usePrivacy } from '@/context/privacy-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';
import { formatPercentage, formatCurrency } from '@/lib/formatters';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { cn } from '@/lib/utils';

export default function WidgetDistanceFromATH() {
  const { athValue, currentMV, isLoading, isError } = useAllTimeHigh();
  const { isPrivate } = usePrivacy();
  const baseCurrency = useBaseCurrency();
  const { t } = useTranslation('dashboard');

  if (isLoading) {
    return (
      <div className="grid grid-rows-[1fr_auto] flex-1 items-center justify-items-center pb-2">
        <Skeleton className="h-9 w-28" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('errors:generic', 'Error')}</AlertDescription>
      </Alert>
    );
  }

  const ath = new Decimal(athValue);
  const curr = new Decimal(currentMV);

  // (currentMV − ATH) / ATH — always ≤ 0. Guard against ATH = 0.
  const distance = ath.gt(0) ? curr.minus(ath).div(ath) : new Decimal(0);

  const colorClass = isPrivate
    ? undefined
    : distance.gte(0)
      ? 'text-[color:var(--qv-positive)]'
      : 'text-[color:var(--qv-negative)]';

  return (
    <div className="grid grid-rows-[1fr_auto] flex-1 items-center justify-items-center pb-2">
      <span className={cn('text-2xl font-semibold tabular-nums', colorClass)}>
        {isPrivate ? '••••' : formatPercentage(distance.toNumber())}
      </span>
      <span className="text-xs text-muted-foreground">
        {isPrivate
          ? '••••'
          : t('widget.distanceFromAth.currentVsAth', {
              current: formatCurrency(curr.toNumber(), baseCurrency),
              ath: formatCurrency(ath.toNumber(), baseCurrency),
            })}
      </span>
    </div>
  );
}
