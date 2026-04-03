import { useWidgetConfig } from '@/context/widget-config-context';
import { useReportingPeriod, useWidgetPerformanceChart } from '@/api/use-performance';
import { resolveDataSeriesToParams } from '@/lib/data-series-utils';

/**
 * Convenience hook that wires WidgetConfigContext → useWidgetPerformanceChart.
 * Resolves dataSeries, periodOverride from widget config,
 * then delegates to useWidgetPerformanceChart (which deduplicates via TanStack Query).
 */
export function useWidgetChartCalculation() {
  const { dataSeries, periodOverride } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;

  const dsParams = resolveDataSeriesToParams(dataSeries);

  const queryResult = useWidgetPerformanceChart(
    periodStart,
    periodEnd,
    dsParams.filter,
    dsParams.withReference,
    dsParams.taxonomyId,
    dsParams.categoryId,
  );

  return { ...queryResult, periodStart };
}
