import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { usePrivacy } from '@/context/privacy-context';
import { getValueColorStyle } from '@/lib/colors';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';

export default function WidgetTtwror() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.cumulative');
  const value = data ? parseFloat(data.ttwror) : 0;

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
        {isPrivate ? '••••••' : (
          <NumberFlow
            className="muted-fraction"
            value={value}
            locales={i18n.language}
            format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
          />
        )}
      </span>
      <span className="text-xs text-muted-foreground mt-5">{periodLabel}</span>
    </div>
  );
}
