import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { formatPercentage } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useCountUp } from '@/hooks/use-count-up';
import { getValueColorStyle } from '@/lib/colors';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WidgetTtwrorPa() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.annualized');
  const value = data ? parseFloat(data.ttwrorPa) : 0;
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
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-1">
      <span className="text-2xl font-semibold tabular-nums" style={getValueColorStyle(value, isPrivate)}>
        {isPrivate ? '••••••' : formatPercentage(animated)}
      </span>
      <span className="text-xs text-muted-foreground mt-5">{periodLabel}</span>
    </div>
  );
}
