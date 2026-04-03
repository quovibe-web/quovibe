import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import { useReportingPeriod } from './use-performance';
import type { BarInterval } from '@quovibe/shared';

interface PeriodicReturnsResponse {
  interval: string;
  returns: Array<{ date: string; return: string }>;
}

export interface PeriodicReturnPoint {
  date: string;
  value: number;
}

export function usePeriodicReturns(interval: BarInterval | null) {
  const { periodStart, periodEnd } = useReportingPeriod();

  return useQuery({
    queryKey: ['performance', 'periodic-returns', interval, periodStart, periodEnd],
    queryFn: async (): Promise<PeriodicReturnPoint[]> => {
      const data = await apiFetch<PeriodicReturnsResponse>(
        `/api/performance/periodic-returns?periodStart=${periodStart}&periodEnd=${periodEnd}&interval=${interval}`,
      );
      return data.returns.map((r) => ({
        date: r.date,
        value: parseFloat(r.return),
      }));
    },
    enabled: interval !== null,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
}
