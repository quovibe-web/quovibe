import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { usePrivacy } from '@/context/privacy-context';
import { useCountUp } from '@/hooks/use-count-up';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WidgetMaxDrawdownDuration() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const { t } = useTranslation('dashboard');
  const days = data?.maxDrawdownDuration ?? 0;
  const animated = useCountUp(days, 1200, !isPrivate);
  const animatedDays = Math.round(animated); // native-ok

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
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-1">
      <span className="text-2xl font-semibold tabular-nums">
        {isPrivate ? '••••••' : t('widget.days', { count: animatedDays })}
      </span>
      <span className="text-xs text-muted-foreground mt-5">{periodLabel}</span>
    </div>
  );
}
