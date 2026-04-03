import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import { useReportingPeriod } from './use-performance';
import type { TaxonomySliceResponse } from './types';

export function useTaxonomySeries(
  taxonomyId: string | undefined,
  categoryIds: string[],
) {
  const { periodStart, periodEnd } = useReportingPeriod();
  const sortedIds = [...categoryIds].sort().join(',');

  return useQuery({
    queryKey: ['performance', 'taxonomy-series', taxonomyId, sortedIds, periodStart, periodEnd] as const,
    queryFn: () =>
      apiFetch<TaxonomySliceResponse[]>(
        `/api/performance/taxonomy-series?taxonomyId=${taxonomyId}&categoryIds=${sortedIds}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      ),
    enabled: !!taxonomyId && categoryIds.length > 0,
    placeholderData: keepPreviousData,
  });
}
