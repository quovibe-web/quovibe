import Decimal from 'decimal.js';
import { useAllTimeHigh } from '@/api/use-ath';
import { usePrivacy } from '@/context/privacy-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';
import { formatPercentage, formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export default function WidgetDistanceFromATH() {
  const { athValue, currentMV, isLoading, isError } = useAllTimeHigh();
  const { isPrivate } = usePrivacy();
  const { t } = useTranslation('dashboard');

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-1">
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

  const colorClass = distance.gte(0)
    ? 'text-[color:var(--qv-positive)]'
    : 'text-[color:var(--qv-negative)]';

  const privacyFilter = isPrivate ? 'blur(8px) saturate(0)' : 'none';

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-1">
      <span
        className={cn('text-2xl font-semibold tabular-nums', colorClass)}
        style={{ filter: privacyFilter }}
      >
        {formatPercentage(distance.toNumber())}
      </span>
      <span
        className="text-xs text-muted-foreground mt-5"
        style={{ filter: privacyFilter }}
      >
        {t('widget.distanceFromAth.currentVsAth', {
          current: formatCurrency(curr.toNumber()),
          ath: formatCurrency(ath.toNumber()),
        })}
      </span>
    </div>
  );
}
