import { useWidgetConfig } from '@/context/widget-config-context';
import { useCalculation, useReportingPeriod } from '@/api/use-performance';
import { resolveDataSeriesToParams } from '@/lib/data-series-utils';
import { CostMethod } from '@quovibe/shared';

const VALID_COST_METHODS = new Set(Object.values(CostMethod));

/**
 * Convenience hook that wires WidgetConfigContext → useCalculation.
 * Resolves dataSeries, periodOverride, and costMethod from widget config,
 * then delegates to useCalculation (which deduplicates via TanStack Query).
 */
export function useWidgetCalculation() {
  const { dataSeries, periodOverride, options } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;

  const dsParams = resolveDataSeriesToParams(dataSeries);
  const costMethod =
    typeof options.costMethod === 'string' && VALID_COST_METHODS.has(options.costMethod as CostMethod)
      ? (options.costMethod as CostMethod)
      : CostMethod.MOVING_AVERAGE;

  return useCalculation(
    dsParams.preTax,
    costMethod,
    periodStart,
    periodEnd,
    dsParams.filter,
    dsParams.withReference,
    dsParams.taxonomyId,
    dsParams.categoryId,
  );
}
