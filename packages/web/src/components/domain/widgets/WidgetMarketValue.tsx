import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WidgetMarketValue() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.now');
  const value = data ? parseFloat(data.finalValue) : 0;

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
      <CurrencyDisplay
        value={value}
        className="text-2xl font-semibold tabular-nums"
      />
      <span className="text-xs text-muted-foreground mt-5">{periodLabel}</span>
    </div>
  );
}
