import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCalculation } from '@/api/use-performance';
import { usePrivacy } from '@/context/privacy-context';
import { AccessibleNumberFlow } from '@/components/shared/AccessibleNumberFlow';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { MetricsStripSettings } from './MetricsStripSettings';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const DEFAULT_METRICS = ['ttwror', 'delta', 'irr', 'max-drawdown'];

interface MetricsStripProps {
  metricIds?: string[];
  onMetricIdsChange: (ids: string[]) => void;
}

/** Maps metric ID to field in CalculationBreakdownResponse + display format */
function resolveMetric(
  id: string,
  data: Record<string, string | number | boolean | null>,
): { value: number; format: 'percent' | 'currency' } | null {
  switch (id) {
    case 'ttwror':
      return { value: parseFloat(data.ttwror as string), format: 'percent' };
    case 'ttwror-pa':
      return { value: parseFloat(data.ttwrorPa as string), format: 'percent' };
    case 'irr':
      return data.irrConverged && data.irr != null
        ? { value: parseFloat(data.irr as string), format: 'percent' }
        : null;
    case 'delta':
      return { value: parseFloat(data.deltaValue as string), format: 'currency' };
    case 'absolute-performance':
      return { value: parseFloat(data.absolutePerformance as string), format: 'currency' };
    case 'absolute-change':
      return { value: parseFloat(data.absoluteChange as string), format: 'currency' };
    case 'max-drawdown':
      return { value: -parseFloat(data.maxDrawdown as string), format: 'percent' };
    case 'current-drawdown':
      return { value: -parseFloat(data.currentDrawdown as string), format: 'percent' };
    case 'volatility':
      return { value: parseFloat(data.volatility as string), format: 'percent' };
    case 'semivariance':
      return { value: parseFloat(data.semivariance as string), format: 'percent' };
    case 'sharpe-ratio':
      return data.sharpeRatio != null
        ? { value: parseFloat(data.sharpeRatio as string), format: 'percent' }
        : null;
    case 'invested-capital':
      return { value: parseFloat(data.initialValue as string), format: 'currency' };
    case 'all-time-high':
      return { value: parseFloat(data.finalValue as string), format: 'currency' };
    case 'distance-from-ath':
      return { value: parseFloat(data.currentDrawdown as string), format: 'percent' };
    case 'cash-drag':
      return null;
    default:
      return null;
  }
}

function getColorClass(id: string, value: number): string | undefined {
  const signColored = [
    'ttwror', 'ttwror-pa', 'irr', 'delta',
    'absolute-performance', 'absolute-change', 'sharpe-ratio',
  ];
  if (signColored.includes(id)) {
    if (value > 0) return 'text-[var(--qv-positive)]';
    if (value < 0) return 'text-[var(--qv-negative)]';
    return undefined;
  }
  const dangerMetrics = ['max-drawdown', 'current-drawdown', 'distance-from-ath'];
  if (dangerMetrics.includes(id) && value !== 0) return 'text-[var(--qv-negative)]';
  return undefined;
}

export function DashboardMetricsStrip({ metricIds, onMetricIdsChange }: MetricsStripProps) {
  const { t } = useTranslation('dashboard');
  const { data: calc, isLoading } = useCalculation();
  const { isPrivate } = usePrivacy();
  const ids = metricIds ?? DEFAULT_METRICS;

  if (ids.length === 0) {
    return (
      <div className="flex justify-end py-2">
        <MetricsStripSettings selected={ids} onChange={onMetricIdsChange} />
      </div>
    );
  }

  if (isLoading || !calc) {
    return (
      <div className="flex gap-0 py-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 px-3">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center qv-fade-in">
      <div className="flex flex-1 flex-wrap md:flex-nowrap gap-0">
        {ids.map((id, i) => {
          const resolved = resolveMetric(id, calc as unknown as Record<string, string | number | boolean | null>);
          const isLast = i === ids.length - 1;

          return (
            <div
              key={id}
              className={cn(
                'flex-1 min-w-0 py-2 px-3',
                !isLast && 'md:border-r md:border-border',
                'basis-1/2 md:basis-auto',
              )}
            >
              <div className="flex items-center gap-1">
                <span className="text-[0.6rem] text-muted-foreground uppercase tracking-wider font-medium truncate" title={t(`widgetTypes.${id}`)}>
                  {t(`widgetTypes.${id}`)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-muted-foreground/40 hover:text-muted-foreground shrink-0">
                      <Info className="size-2.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    <p className="text-xs">{t(`catalog.desc.${id}`)}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className={cn('text-lg font-semibold mt-0.5', resolved ? getColorClass(id, resolved.value) : undefined)}>
                {isPrivate ? (
                  '••••••'
                ) : resolved === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : resolved.format === 'currency' ? (
                  <CurrencyDisplay value={resolved.value} colorize className="text-lg font-semibold" />
                ) : (
                  <AccessibleNumberFlow
                    className="muted-fraction"
                    value={resolved.value}
                    format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <MetricsStripSettings selected={ids} onChange={onMetricIdsChange} />
    </div>
  );
}
