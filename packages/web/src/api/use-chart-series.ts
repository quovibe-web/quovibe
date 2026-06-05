import { useMemo } from 'react';
import { useQueries, keepPreviousData } from '@tanstack/react-query';
import { useChartConfig } from './use-chart-config';
import { useReportingPeriod } from './use-performance';
import { useScopedApi } from './use-scoped-api';
import type {
  DataSeriesConfig,
  BenchmarkSeriesResponse,
  SecuritySeriesResponse,
} from '@quovibe/shared';

interface ChartPointResponse {
  date: string;
  ttwrorCumulative: string;
  marketValue: string;
  transfersAccumulated: string;
  delta: string;
  drawdown: string;
}

export interface SeriesDataPoint {
  date: string;
  value: number;
}

export interface ResolvedSeries {
  config: DataSeriesConfig;
  data: SeriesDataPoint[];
  status: 'loading' | 'ok' | 'empty' | 'error';
  isLoading: boolean;
  error: Error | null;
}

export function resolveSeriesStatus(q: {
  isLoading: boolean;
  data: readonly unknown[] | undefined;
  error: Error | null;
}): ResolvedSeries['status'] {
  if (q.error) return 'error';
  if (q.isLoading) return 'loading';
  if ((q.data ?? []).length === 0) return 'empty'; // native-ok
  return 'ok';
}

function buildQueryKey(
  pid: string,
  series: DataSeriesConfig,
  periodStart: string,
  periodEnd: string,
): readonly unknown[] {
  switch (series.type) {
    case 'portfolio':
      return ['portfolios', pid, 'chart-series', 'portfolio', periodStart, periodEnd];
    case 'security':
      return ['portfolios', pid, 'chart-series', 'security', series.securityId, periodStart, periodEnd];
    case 'benchmark':
      return ['portfolios', pid, 'chart-series', 'benchmark', series.securityId, periodStart, periodEnd];
    case 'account':
      return ['portfolios', pid, 'chart-series', 'account', series.accountId, periodStart, periodEnd];
  }
}

async function fetchSeriesData(
  scopedFetch: <T>(url: string, init?: RequestInit) => Promise<T>,
  series: DataSeriesConfig,
  periodStart: string,
  periodEnd: string,
): Promise<SeriesDataPoint[]> {
  switch (series.type) {
    case 'portfolio': {
      const data = await scopedFetch<ChartPointResponse[]>(
        `/api/performance/chart?periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      return data.map((p) => ({
        date: p.date,
        value: parseFloat(p.ttwrorCumulative),
      }));
    }
    case 'security': {
      const data = await scopedFetch<SecuritySeriesResponse>(
        `/api/performance/security-series?securityId=${series.securityId}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      return data.series.map((p) => ({
        date: p.date,
        value: parseFloat(p.cumulativeReturn),
      }));
    }
    case 'benchmark': {
      const data = await scopedFetch<BenchmarkSeriesResponse>(
        `/api/performance/benchmark-series?securityIds=${series.securityId}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      const bm = data.benchmarks[0];
      if (!bm) return [];
      return bm.series.map((p) => ({
        date: p.date,
        value: parseFloat(p.cumulative),
      }));
    }
    case 'account':
      // Deferred — return empty array
      return [];
  }
}

export function useChartSeries() {
  const api = useScopedApi();
  const { data: config } = useChartConfig();
  const { periodStart, periodEnd } = useReportingPeriod();

  const seriesList = config?.series ?? [];

  const queries = useQueries({
    queries: seriesList.map((s) => ({
      queryKey: buildQueryKey(api.portfolioId, s, periodStart, periodEnd),
      queryFn: () => fetchSeriesData(api.fetch, s, periodStart, periodEnd),
      enabled: s.visible,
      placeholderData: keepPreviousData,
      staleTime: 5 * 60 * 1000,
      refetchInterval: 60_000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  // Stable key: only recompute when query data, loading states, or configs change
  const queryKey = queries.map((q) => `${q.dataUpdatedAt ?? 0}:${q.isLoading}`).join('|');
  const configKey = JSON.stringify(seriesList.map((s) => s.id));

  const result: ResolvedSeries[] = useMemo(
    () =>
      seriesList.map((cfg, i) => {
        const q = queries[i];
        const data = q?.data ?? [];
        const isLoading = q?.isLoading ?? false;
        const error = (q?.error as Error) ?? null;
        const status = resolveSeriesStatus({ isLoading, data, error });
        return { config: cfg, data, status, isLoading, error };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey, configKey],
  );

  return { series: result, isLoading };
}
