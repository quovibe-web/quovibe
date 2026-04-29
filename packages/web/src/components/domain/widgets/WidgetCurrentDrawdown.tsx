import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { usePrivacy } from '@/context/privacy-context';
import { getColor } from '@/lib/colors';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AccessibleNumberFlow } from '@/components/shared/AccessibleNumberFlow';

export default function WidgetCurrentDrawdown() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.now');
  const cd = data ? parseFloat(data.currentDrawdown) : 0;
  const displayVal = cd === 0 ? 0 : -cd;

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
      <span
        className="text-2xl font-semibold tabular-nums"
        style={{ color: isPrivate || cd === 0 ? undefined : getColor('danger') }}
      >
        {isPrivate ? '••••••' : (
          <AccessibleNumberFlow
            className="muted-fraction"
            value={displayVal}
            format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
          />
        )}
      </span>
      <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
    </div>
  );
}
