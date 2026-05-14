import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import { useReportingPeriod } from './use-performance';
import type { TaxonomySliceResponse } from './types';

export function useTaxonomySeries(
  taxonomyId: string | undefined,
  categoryIds: string[],
) {
  const api = useScopedApi();
  const { periodStart, periodEnd } = useReportingPeriod();
  const sortedIds = [...categoryIds].sort().join(',');

  return useQuery({
    queryKey: ['portfolios', api.portfolioId, 'performance', 'taxonomy-series', taxonomyId, sortedIds, periodStart, periodEnd] as const,
    queryFn: () =>
      api.fetch<TaxonomySliceResponse[]>(
        `/api/performance/taxonomy-series?taxonomyId=${taxonomyId}&categoryIds=${sortedIds}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      ),
    enabled: !!taxonomyId && categoryIds.length > 0,
    placeholderData: keepPreviousData,
  });
}
