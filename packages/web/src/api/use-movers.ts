import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useReportingPeriod } from './use-performance';
import { resolveDataSeriesToParams } from '@/lib/data-series-utils';
import { CostMethod } from '@quovibe/shared';
import type { MoversResponse } from './types';

const VALID_COST_METHODS = new Set(Object.values(CostMethod));

export const moversKeys = {
  list: (
    start: string, end: string, count: number,
    preTax: boolean, costMethod: CostMethod,
    filter?: string, withReference?: boolean,
    taxonomyId?: string, categoryId?: string,
  ) => ['performance', 'movers', start, end, count, preTax, costMethod,
        filter, withReference, taxonomyId, categoryId] as const,
};

export function useMovers(count = 3) {
  const { dataSeries, periodOverride, options } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;

  const dsParams = resolveDataSeriesToParams(dataSeries);
  const costMethod =
    typeof options.costMethod === 'string' && VALID_COST_METHODS.has(options.costMethod as CostMethod)
      ? (options.costMethod as CostMethod)
      : CostMethod.MOVING_AVERAGE;

  return useQuery({
    queryKey: moversKeys.list(
      periodStart, periodEnd, count,
      dsParams.preTax, costMethod,
      dsParams.filter, dsParams.withReference,
      dsParams.taxonomyId, dsParams.categoryId,
    ),
    queryFn: () => {
      const params = new URLSearchParams({
        periodStart,
        periodEnd,
        count: String(count),
        preTax: String(dsParams.preTax),
        costMethod,
      });
      if (dsParams.filter) params.set('filter', dsParams.filter);
      if (dsParams.withReference !== undefined) params.set('withReference', String(dsParams.withReference));
      if (dsParams.taxonomyId) params.set('taxonomyId', dsParams.taxonomyId);
      if (dsParams.categoryId) params.set('categoryId', dsParams.categoryId);
      return apiFetch<MoversResponse>(`/api/performance/movers?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });
}
