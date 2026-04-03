import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { BenchmarkSeriesResponse } from '@quovibe/shared';
import { useReportingPeriod } from './use-performance';

export const benchmarkKeys = {
  series: (ids: string[], start: string, end: string) =>
    ['performance', 'benchmark-series', ids, start, end] as const,
};

interface BenchmarkSeriesOptions {
  interval?: string;
  periodStart?: string;
  periodEnd?: string;
}

export function useBenchmarkSeries(securityIds: string[], options?: BenchmarkSeriesOptions) {
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const interval = options?.interval ?? 'auto';
  const periodStart = options?.periodStart ?? urlStart;
  const periodEnd = options?.periodEnd ?? urlEnd;
  return useQuery({
    queryKey: benchmarkKeys.series(securityIds, periodStart, periodEnd),
    queryFn: () =>
      apiFetch<BenchmarkSeriesResponse>(
        `/api/performance/benchmark-series?securityIds=${securityIds.join(',')}&periodStart=${periodStart}&periodEnd=${periodEnd}&interval=${interval}`
      ),
    enabled: securityIds.length > 0,
    placeholderData: keepPreviousData,
  });
}
