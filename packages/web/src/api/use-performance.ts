import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useScopedApi } from './use-scoped-api';
import { format, startOfYear } from 'date-fns';
import type { ChartPointResponse, SecurityPerfResponse, ReturnsHeatmapResponse } from './types';
import type { CalculationBreakdownResponse, DataSeriesValue } from '@quovibe/shared';
import { CostMethod } from '@quovibe/shared';

// Module-level cache: remembers the last active period so that navigating
// to a page without search params doesn't briefly flash YTD defaults.
let _cachedStart: string | null = null;
let _cachedEnd: string | null = null;

export function useReportingPeriod() {
  const [searchParams, setSearchParams] = useSearchParams();

  const today = new Date();
  const defaultEnd = format(today, 'yyyy-MM-dd');
  const defaultStart = format(startOfYear(today), 'yyyy-MM-dd');

  const urlStart = searchParams.get('periodStart');
  const urlEnd = searchParams.get('periodEnd');

  // Use URL params if present, then cached values, then YTD defaults
  const periodStart = urlStart ?? _cachedStart ?? defaultStart;
  const periodEnd = urlEnd ?? _cachedEnd ?? defaultEnd;

  // Keep cache in sync whenever URL params are present
  if (urlStart && urlEnd) {
    _cachedStart = urlStart;
    _cachedEnd = urlEnd;
  }

  function setPeriod(start: string, end: string) {
    _cachedStart = start;
    _cachedEnd = end;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('periodStart', start);
      next.set('periodEnd', end);
      return next;
    }, { replace: true });
  }

  return { periodStart, periodEnd, setPeriod };
}

export const performanceKeys = {
  calculation: (pid: string, start: string, end: string, preTax?: boolean, costMethod?: CostMethod,
                filter?: string, withReference?: boolean, taxonomyId?: string, categoryId?: string) =>
    ['portfolios', pid, 'performance', 'calculation', start, end, preTax, costMethod, filter, withReference, taxonomyId, categoryId] as const,
  securities: (pid: string, start: string, end: string) =>
    ['portfolios', pid, 'performance', 'securities', start, end] as const,
  chart: (pid: string, start: string, end: string, filter?: string, withReference?: boolean, taxonomyId?: string, categoryId?: string) =>
    ['portfolios', pid, 'performance', 'chart', start, end, filter, withReference, taxonomyId, categoryId] as const,
  returns: (pid: string, start?: string, end?: string, filter?: string, withReference?: boolean, taxonomyId?: string, categoryId?: string) =>
    ['portfolios', pid, 'performance', 'returns', start, end, filter, withReference, taxonomyId, categoryId] as const,
  resolveSeries: (pid: string, value: DataSeriesValue | null) =>
    ['portfolios', pid, 'performance', 'resolve-series', value] as const,
};

export function useCalculation(
  preTax = true,
  costMethod = CostMethod.MOVING_AVERAGE,
  periodStartOverride?: string,
  periodEndOverride?: string,
  filter?: string,
  withReference?: boolean,
  taxonomyId?: string,
  categoryId?: string,
) {
  const api = useScopedApi();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const periodStart = periodStartOverride ?? urlStart;
  const periodEnd = periodEndOverride ?? urlEnd;

  return useQuery({
    queryKey: performanceKeys.calculation(api.portfolioId, periodStart, periodEnd, preTax, costMethod, filter, withReference, taxonomyId, categoryId),
    queryFn: () => {
      const params = new URLSearchParams({
        periodStart,
        periodEnd,
        preTax: String(preTax),
        costMethod,
      });
      if (filter) params.set('filter', filter);
      if (withReference !== undefined) params.set('withReference', String(withReference));
      if (taxonomyId) params.set('taxonomyId', taxonomyId);
      if (categoryId) params.set('categoryId', categoryId);
      return api.fetch<CalculationBreakdownResponse>(
        `/api/performance/calculation?${params.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}

export function usePerformanceSecurities(options?: {
  enabled?: boolean;
  periodStart?: string;
  periodEnd?: string;
}) {
  const api = useScopedApi();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const periodStart = options?.periodStart ?? urlStart;
  const periodEnd = options?.periodEnd ?? urlEnd;
  return useQuery({
    queryKey: performanceKeys.securities(api.portfolioId, periodStart, periodEnd),
    queryFn: () =>
      api.fetch<SecurityPerfResponse[]>(
        `/api/performance/securities?periodStart=${periodStart}&periodEnd=${periodEnd}&preTax=false`,
      ),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function usePerformanceChart(options?: {
  periodStart?: string;
  periodEnd?: string;
}) {
  const api = useScopedApi();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const periodStart = options?.periodStart ?? urlStart;
  const periodEnd = options?.periodEnd ?? urlEnd;
  return useQuery({
    queryKey: performanceKeys.chart(api.portfolioId, periodStart, periodEnd),
    queryFn: () =>
      api.fetch<ChartPointResponse[]>(
        `/api/performance/chart?periodStart=${periodStart}&periodEnd=${periodEnd}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useWidgetPerformanceChart(
  periodStartOverride?: string,
  periodEndOverride?: string,
  filter?: string,
  withReference?: boolean,
  taxonomyId?: string,
  categoryId?: string,
) {
  const api = useScopedApi();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const periodStart = periodStartOverride ?? urlStart;
  const periodEnd = periodEndOverride ?? urlEnd;

  return useQuery({
    queryKey: performanceKeys.chart(api.portfolioId, periodStart, periodEnd, filter, withReference, taxonomyId, categoryId),
    queryFn: () => {
      const params = new URLSearchParams({
        periodStart,
        periodEnd,
        interval: 'auto',
      });
      if (filter) params.set('filter', filter);
      if (withReference !== undefined) params.set('withReference', String(withReference));
      if (taxonomyId) params.set('taxonomyId', taxonomyId);
      if (categoryId) params.set('categoryId', categoryId);
      return api.fetch<ChartPointResponse[]>(
        `/api/performance/chart?${params.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}

export function useReturnsHeatmap(
  periodStartOverride?: string,
  periodEndOverride?: string,
  filter?: string,
  withReference?: boolean,
  taxonomyId?: string,
  categoryId?: string,
) {
  const api = useScopedApi();
  return useQuery({
    queryKey: performanceKeys.returns(api.portfolioId, periodStartOverride, periodEndOverride, filter, withReference, taxonomyId, categoryId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (periodStartOverride) params.set('periodStart', periodStartOverride);
      if (periodEndOverride) params.set('periodEnd', periodEndOverride);
      if (filter) params.set('filter', filter);
      if (withReference !== undefined) params.set('withReference', String(withReference));
      if (taxonomyId) params.set('taxonomyId', taxonomyId);
      if (categoryId) params.set('categoryId', categoryId);
      const qs = params.toString();
      return api.fetch<ReturnsHeatmapResponse>(`/api/performance/returns${qs ? `?${qs}` : ''}`);
    },
  });
}

interface ResolveSeriesResponse {
  label: string;
  params: Record<string, unknown>;
}

export function useResolveSeriesLabel(value: DataSeriesValue | null) {
  const api = useScopedApi();
  return useQuery({
    queryKey: performanceKeys.resolveSeries(api.portfolioId, value),
    queryFn: () =>
      api.fetch<ResolveSeriesResponse>('/api/performance/resolve-series', {
        method: 'POST',
        body: JSON.stringify(value),
      }),
    enabled: value !== null,
    staleTime: 5 * 60 * 1000,
  });
}
