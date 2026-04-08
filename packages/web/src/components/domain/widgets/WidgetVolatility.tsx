import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { usePrivacy } from '@/context/privacy-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';

export default function WidgetVolatility() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const vol = data ? parseFloat(data.volatility) : 0;

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
        {isPrivate ? '••••••' : (
          <NumberFlow
            className="muted-fraction"
            value={vol}
            locales={i18n.language}
            format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
          />
        )}
      </span>
      <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
    </div>
  );
}
