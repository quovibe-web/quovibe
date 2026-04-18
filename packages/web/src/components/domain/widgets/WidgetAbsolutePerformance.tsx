import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { usePrivacy } from '@/context/privacy-context';
import { getValueColorStyle } from '@/lib/colors';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AccessibleNumberFlow } from '@/components/shared/AccessibleNumberFlow';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export default function WidgetAbsolutePerformance() {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, isError, error } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta('widget.qualifier.period');
  const absPerf = data ? parseFloat(data.absolutePerformance) : 0;
  const absPerfPct = data ? parseFloat(data.absolutePerformancePct) : 0;

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
        value={absPerf}
        colorize
        className="text-2xl font-semibold tabular-nums"
      />
      <span
        className="text-sm tabular-nums"
        style={getValueColorStyle(absPerfPct, isPrivate)}
      >
        {isPrivate ? '••••••' : <AccessibleNumberFlow className="muted-fraction" value={absPerfPct} format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }} />}
      </span>
      <span className="text-xs text-muted-foreground pt-5 inline-flex items-center gap-1">
        {periodLabel}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground/40 hover:text-muted-foreground shrink-0"
              aria-label={t('widgetTypes.absolute-performance')}
            >
              <Info className="size-2.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[240px]">
            <p className="text-xs">{t('catalog.desc.absolute-performance')}</p>
          </TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}
