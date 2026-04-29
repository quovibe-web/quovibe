import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import { useReportingPeriod } from './use-performance';
import type { StatementOfAssetsResponse, HoldingsResponse, PaymentsResponse, AssetAllocationResponse } from './types';
import type { PaymentBreakdownResponse } from '@quovibe/shared';

export const reportsKeys = {
  statement: (pid: string, date: string) =>
    ['portfolios', pid, 'reports', 'statement', date] as const,
  holdings: (pid: string, date: string) =>
    ['portfolios', pid, 'reports', 'holdings', date] as const,
  payments: (pid: string, start: string, end: string, groupBy: string) =>
    ['portfolios', pid, 'reports', 'payments', start, end, groupBy] as const,
  paymentsBreakdown: (
    pid: string,
    bucket: string | null,
    type: string,
    groupBy: string,
    start: string,
    end: string,
  ) => ['portfolios', pid, 'reports', 'paymentsBreakdown', bucket, type, groupBy, start, end] as const,
  assetAllocation: (pid: string, date: string, taxonomyId: string) =>
    ['portfolios', pid, 'reports', 'assetAllocation', date, taxonomyId] as const,
};

export function useStatementOfAssets(date?: string, options?: { enabled?: boolean }) {
  const api = useScopedApi();
  const today = new Date().toISOString().slice(0, 10);
  const d = date ?? today;
  return useQuery({
    queryKey: reportsKeys.statement(api.portfolioId, d),
    queryFn: () => api.fetch<StatementOfAssetsResponse>(`/api/reports/statement-of-assets?date=${d}`),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useHoldings(date?: string) {
  const api = useScopedApi();
  const today = new Date().toISOString().slice(0, 10);
  const d = date ?? today;
  return useQuery({
    queryKey: reportsKeys.holdings(api.portfolioId, d),
    queryFn: () => api.fetch<HoldingsResponse>(`/api/reports/holdings?date=${d}`),
  });
}

export function useAssetAllocation(date: string, taxonomyId: string | undefined) {
  const api = useScopedApi();
  return useQuery({
    queryKey: reportsKeys.assetAllocation(api.portfolioId, date, taxonomyId ?? ''),
    queryFn: () =>
      api.fetch<AssetAllocationResponse>(
        `/api/reports/holdings?date=${date}&taxonomy=${taxonomyId}`,
      ),
    enabled: !!taxonomyId,
    placeholderData: keepPreviousData,
  });
}

export function usePayments(groupBy: string) {
  const api = useScopedApi();
  const { periodStart, periodEnd } = useReportingPeriod();
  return useQuery({
    queryKey: reportsKeys.payments(api.portfolioId, periodStart, periodEnd, groupBy),
    queryFn: () =>
      api.fetch<PaymentsResponse>(
        `/api/reports/payments?periodStart=${periodStart}&periodEnd=${periodEnd}&groupBy=${groupBy}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentsBreakdown(
  bucket: string | null,
  type: 'DIVIDEND' | 'INTEREST',
  groupBy: 'month' | 'quarter' | 'year',
) {
  const api = useScopedApi();
  const { periodStart, periodEnd } = useReportingPeriod();
  return useQuery({
    queryKey: reportsKeys.paymentsBreakdown(api.portfolioId, bucket, type, groupBy, periodStart, periodEnd),
    queryFn: () => {
      if (!bucket) throw new Error('bucket is required');
      return api.fetch<PaymentBreakdownResponse>(
        `/api/reports/payments/breakdown?bucket=${encodeURIComponent(bucket)}&type=${type}&groupBy=${groupBy}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
    },
    enabled: !!bucket,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
