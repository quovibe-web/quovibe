import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { useWidgetConfig } from '@/context/widget-config-context';
import { usePrivacy } from '@/context/privacy-context';
import { getColor } from '@/lib/colors';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';

export default function WidgetSharpeRatio() {
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const { options } = useWidgetConfig();
  const irr = data?.irr !== null ? parseFloat(data?.irr ?? '0') : null;
  const vol = data ? parseFloat(data.volatility) : 0;
  const riskFreeRate = typeof options.riskFreeRate === 'number' ? options.riskFreeRate : 0;
  const sharpe = irr !== null && vol > 0 ? (irr - riskFreeRate) / vol : null;

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

  const color =
    isPrivate || sharpe === null
      ? undefined
      : sharpe > 0
        ? getColor('success')
        : sharpe < 0
          ? getColor('danger')
          : undefined;

  return (
    <div className="grid grid-rows-[1fr_auto] flex-1 items-center justify-items-center pb-2">
      <span
        className="text-2xl font-semibold tabular-nums"
        style={{ color }}
      >
        {isPrivate ? '••••••' : sharpe !== null ? (
          <NumberFlow
            className="muted-fraction"
            value={sharpe}
            locales={i18n.language}
            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
          />
        ) : '—'}
      </span>
      <span className="text-xs text-muted-foreground pt-5">{periodLabel}</span>
    </div>
  );
}
