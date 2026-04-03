import Decimal from 'decimal.js';
import { useMemo } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import { useFirstTransactionDate } from './use-transactions';
import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import type { ChartPointResponse } from './types';

export interface ATHResult {
  athValue: string;
  athDate: string | null;
}

/**
 * Finds the All-Time High from a series of daily chart points.
 * Seeds from the first point so all-negative portfolios return the least-negative day.
 * Uses Decimal.js — no native float arithmetic.
 * Returns { athValue: '0', athDate: null } when the array is empty or all zeros.
 */
export function computeATH(points: ChartPointResponse[]): ATHResult {
  if (points.length === 0) return { athValue: '0', athDate: null };

  let maxVal = new Decimal(points[0].marketValue);
  let maxDate: string = points[0].date;

  for (let i = 1; i < points.length; i++) { // native-ok (array index)
    const mv = new Decimal(points[i].marketValue);
    if (mv.gt(maxVal)) {
      maxVal = mv;
      maxDate = points[i].date;
    }
  }

  if (maxVal.isZero()) return { athValue: '0', athDate: null };
  return { athValue: maxVal.toString(), athDate: maxDate };
}

export const athKeys = {
  chart: (inception: string, today: string) =>
    ['ath', 'chart', inception, today] as const,
};

export interface AllTimeHighResult {
  athValue: string;
  athDate: string | null;
  currentMV: string;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Returns the portfolio's all-time high (inception → today) and the current
 * period-aware market value. ATH ignores the widget period override entirely.
 * Both sub-queries are deduplicated by React Query key.
 */
export function useAllTimeHigh(): AllTimeHighResult {
  const { data: firstDateData, isLoading: dateLoading } = useFirstTransactionDate();
  const inception = firstDateData?.date ?? null;
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const chartQuery = useQuery({
    queryKey: athKeys.chart(inception ?? '', todayStr),
    queryFn: () =>
      apiFetch<ChartPointResponse[]>(
        `/api/performance/chart?periodStart=${inception}&periodEnd=${todayStr}&interval=daily`
      ),
    enabled: inception !== null,
    staleTime: 5 * 60 * 1000,
    placeholderData: undefined,
  });

  const {
    data: calcData,
    isLoading: calcLoading,
    isError: calcError,
  } = useWidgetCalculation();

  const { athValue, athDate } = useMemo(
    () => computeATH(chartQuery.data ?? []),
    [chartQuery.data],
  );

  return {
    athValue,
    athDate,
    currentMV: calcData?.finalValue ?? '0',
    isLoading: dateLoading || chartQuery.isLoading || calcLoading,
    isError: chartQuery.isError || calcError,
  };
}
