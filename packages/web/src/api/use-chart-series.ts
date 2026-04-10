import { useMemo } from 'react';
import { useQueries, keepPreviousData } from '@tanstack/react-query';
import { useChartConfig } from './use-chart-config';
import { useReportingPeriod } from './use-performance';
import { apiFetch } from './fetch';
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
  isLoading: boolean;
  error: Error | null;
}

function buildQueryKey(
  series: DataSeriesConfig,
  periodStart: string,
  periodEnd: string,
): readonly unknown[] {
  switch (series.type) {
    case 'portfolio':
      return ['chart-series', 'portfolio', periodStart, periodEnd];
    case 'security':
      return ['chart-series', 'security', series.securityId, periodStart, periodEnd];
    case 'benchmark':
      return ['chart-series', 'benchmark', series.securityId, periodStart, periodEnd];
    case 'account':
      return ['chart-series', 'account', series.accountId, periodStart, periodEnd];
  }
}

async function fetchSeriesData(
  series: DataSeriesConfig,
  periodStart: string,
  periodEnd: string,
): Promise<SeriesDataPoint[]> {
  switch (series.type) {
    case 'portfolio': {
      const data = await apiFetch<ChartPointResponse[]>(
        `/api/performance/chart?periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      return data.map((p) => ({
        date: p.date,
        value: parseFloat(p.ttwrorCumulative),
      }));
    }
    case 'security': {
      const data = await apiFetch<SecuritySeriesResponse>(
        `/api/performance/security-series?securityId=${series.securityId}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      return data.series.map((p) => ({
        date: p.date,
        value: parseFloat(p.cumulativeReturn),
      }));
    }
    case 'benchmark': {
      const data = await apiFetch<BenchmarkSeriesResponse>(
        `/api/performance/benchmark-series?securityIds=${series.securityId}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      const bm = data.benchmarks[0];
      if (!bm) return [];
      return bm.series.map((p) => ({
        date: p.date,
        value: p.cumulative,
      }));
    }
    case 'account':
      // Deferred — return empty array
      return [];
  }
}

export function useChartSeries() {
  const { data: config } = useChartConfig();
  const { periodStart, periodEnd } = useReportingPeriod();

  const seriesList = config?.series ?? [];

  const queries = useQueries({
    queries: seriesList.map((s) => ({
      queryKey: buildQueryKey(s, periodStart, periodEnd),
      queryFn: () => fetchSeriesData(s, periodStart, periodEnd),
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
      seriesList.map((cfg, i) => ({
        config: cfg,
        data: queries[i]?.data ?? [],
        isLoading: queries[i]?.isLoading ?? false,
        error: (queries[i]?.error as Error) ?? null,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey, configKey],
  );

  return { series: result, isLoading };
}
