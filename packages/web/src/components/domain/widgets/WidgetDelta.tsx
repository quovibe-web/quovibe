import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { formatPercentage } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useCountUp } from '@/hooks/use-count-up';
import { getValueColorStyle } from '@/lib/colors';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function WidgetDelta() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const deltaValue = data ? parseFloat(data.deltaValue) : 0;
  const deltaPct = data ? parseFloat(data.delta) : 0;
  const animatedValue = useCountUp(deltaValue, 1200, !isPrivate);
  const animatedPct = useCountUp(deltaPct, 1200, !isPrivate);

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
        value={animatedValue}
        colorize
        className="text-2xl font-semibold tabular-nums"
      />
      <span
        className="text-sm tabular-nums"
        style={getValueColorStyle(deltaPct, isPrivate)}
      >
        {isPrivate ? '••••••' : formatPercentage(animatedPct)}
      </span>
      <span className="text-xs text-muted-foreground mt-5">{periodLabel}</span>
    </div>
  );
}
