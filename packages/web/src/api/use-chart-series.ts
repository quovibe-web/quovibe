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
    case 'periodic_bars':
      return ['chart-series', 'periodic_bars', periodStart, periodEnd];
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
    case 'periodic_bars':
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

  const result: ResolvedSeries[] = seriesList.map((config, i) => ({
    config,
    data: queries[i]?.data ?? [],
    isLoading: queries[i]?.isLoading ?? false,
    error: (queries[i]?.error as Error) ?? null,
  }));

  const isLoading = queries.some((q) => q.isLoading);

  return { series: result, isLoading };
}
