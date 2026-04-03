import { useAllTimeHigh } from '@/api/use-ath';
import { useCountUp } from '@/hooks/use-count-up';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/formatters';

export default function WidgetAllTimeHigh() {
  const { athValue, athDate, isLoading, isError } = useAllTimeHigh();
  const { isPrivate } = usePrivacy();
  const { t } = useTranslation('dashboard');
  const value = parseFloat(athValue);
  const animated = useCountUp(value, 1200, !isPrivate);

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

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-1">
      <CurrencyDisplay
        value={animated}
        className="text-2xl font-semibold tabular-nums"
      />
      <span className="text-xs text-muted-foreground mt-5">
        {athDate
          ? t('widget.allTimeHigh.athDate', { date: formatDate(athDate) })
          : t('widget.allTimeHigh.noData')}
      </span>
    </div>
  );
}
