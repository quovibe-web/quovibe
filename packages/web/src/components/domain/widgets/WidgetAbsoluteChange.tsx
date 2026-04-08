import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WidgetAbsoluteChange() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const value = data ? parseFloat(data.absoluteChange) : 0;

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
      <CurrencyDisplay
        value={value}
        colorize
        className="text-2xl font-semibold tabular-nums"
      />
      <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
    </div>
  );
}
