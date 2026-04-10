import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { usePrivacy } from '@/context/privacy-context';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WidgetMaxDrawdownDuration() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const { t } = useTranslation('dashboard');
  const days = data?.maxDrawdownDuration ?? 0;

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
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="grid grid-rows-[1fr_auto] flex-1 items-center justify-items-center pb-2">
      <span className="text-2xl font-semibold tabular-nums">
        {isPrivate ? '••••••' : t('widget.days', { count: days })}
      </span>
      <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
    </div>
  );
}
