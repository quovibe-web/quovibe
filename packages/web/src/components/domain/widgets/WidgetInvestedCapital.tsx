import { useWidgetInvestedCapital } from '@/hooks/use-widget-invested-capital';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { useCountUp } from '@/hooks/use-count-up';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';

export default function WidgetInvestedCapital() {
  const { investedCapital, isLoading, isError } = useWidgetInvestedCapital();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const { t } = useTranslation('dashboard');
  const value = parseFloat(investedCapital);
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
      <span className="text-xs text-muted-foreground mt-5">{periodLabel}</span>
    </div>
  );
}
