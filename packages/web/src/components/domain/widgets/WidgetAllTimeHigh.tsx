import { useAllTimeHigh } from '@/api/use-ath';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/formatters';

export default function WidgetAllTimeHigh() {
  const { athValue, athDate, isLoading, isError } = useAllTimeHigh();
  const { t } = useTranslation('dashboard');
  const value = parseFloat(athValue);

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

  return (
    <div className="grid grid-rows-[1fr_auto] flex-1 items-center justify-items-center pb-2">
      <CurrencyDisplay
        value={value}
        className="text-2xl font-semibold tabular-nums"
      />
      <span className="text-xs text-muted-foreground">
        {athDate
          ? t('widget.allTimeHigh.athDate', { date: formatDate(athDate) })
          : t('widget.allTimeHigh.noData')}
      </span>
    </div>
  );
}
