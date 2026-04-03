import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { formatPercentage } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useCountUp } from '@/hooks/use-count-up';
import { getColor } from '@/lib/colors';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WidgetMaxDrawdown() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const mdd = data ? parseFloat(data.maxDrawdown) : 0;
  const displayVal = mdd === 0 ? 0 : -mdd;
  const animated = useCountUp(displayVal, 1200, !isPrivate);

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
      <span
        className="text-2xl font-semibold tabular-nums"
        style={{ color: isPrivate || mdd === 0 ? undefined : getColor('danger') }}
      >
        {isPrivate ? '••••••' : formatPercentage(animated)}
      </span>
      <span className="text-xs text-muted-foreground mt-5">{periodLabel}</span>
    </div>
  );
}
