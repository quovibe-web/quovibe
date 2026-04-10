import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { usePrivacy } from '@/context/privacy-context';
import { getValueColorStyle } from '@/lib/colors';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';

export default function WidgetIrr() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.annualized');
  const value = data?.irrConverged && data.irr !== null ? parseFloat(data.irr) : 0;

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

  if (!data.irrConverged || data.irr === null) {
    return (
      <div className="grid grid-rows-[1fr_auto] flex-1 items-center justify-items-center pb-2">
        <span className="text-2xl font-semibold tabular-nums text-muted-foreground">N/A</span>
        <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-rows-[1fr_auto] flex-1 items-center justify-items-center pb-2">
      <span className="text-2xl font-semibold tabular-nums" style={getValueColorStyle(value, isPrivate)}>
        {isPrivate ? '••••••' : (
          <NumberFlow
            className="muted-fraction"
            value={value}
            locales={i18n.language}
            format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
          />
        )}
      </span>
      <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
    </div>
  );
}
