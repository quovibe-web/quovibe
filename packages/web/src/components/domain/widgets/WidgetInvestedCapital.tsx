import { useWidgetInvestedCapital } from '@/hooks/use-widget-invested-capital';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';

export default function WidgetInvestedCapital() {
  const { investedCapital, isLoading, isError } = useWidgetInvestedCapital();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const { t } = useTranslation('dashboard');
  const value = parseFloat(investedCapital);

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
      <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
    </div>
  );
}
