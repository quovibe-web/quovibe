import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import { useReportingPeriod } from './use-performance';
import type { StatementOfAssetsResponse, HoldingsResponse, PaymentsResponse, AssetAllocationResponse } from './types';
import type { PaymentBreakdownResponse } from '@quovibe/shared';

export const reportsKeys = {
  statement: (date: string) => ['reports', 'statement', date] as const,
  holdings: (date: string) => ['reports', 'holdings', date] as const,
  payments: (start: string, end: string, groupBy: string) =>
    ['reports', 'payments', start, end, groupBy] as const,
  paymentsBreakdown: (
    bucket: string | null,
    type: string,
    groupBy: string,
    start: string,
    end: string,
  ) => ['reports', 'paymentsBreakdown', bucket, type, groupBy, start, end] as const,
  assetAllocation: (date: string, taxonomyId: string) =>
    ['reports', 'assetAllocation', date, taxonomyId] as const,
};

export function useStatementOfAssets(date?: string, options?: { enabled?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const d = date ?? today;
  return useQuery({
    queryKey: reportsKeys.statement(d),
    queryFn: () => apiFetch<StatementOfAssetsResponse>(`/api/reports/statement-of-assets?date=${d}`),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useHoldings(date?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const d = date ?? today;
  return useQuery({
    queryKey: reportsKeys.holdings(d),
    queryFn: () => apiFetch<HoldingsResponse>(`/api/reports/holdings?date=${d}`),
  });
}

export function useAssetAllocation(date: string, taxonomyId: string | undefined) {
  return useQuery({
    queryKey: reportsKeys.assetAllocation(date, taxonomyId ?? ''),
    queryFn: () =>
      apiFetch<AssetAllocationResponse>(
        `/api/reports/holdings?date=${date}&taxonomy=${taxonomyId}`,
      ),
    enabled: !!taxonomyId,
    placeholderData: keepPreviousData,
  });
}

export function usePayments(groupBy: string) {
  const { periodStart, periodEnd } = useReportingPeriod();
  return useQuery({
    queryKey: reportsKeys.payments(periodStart, periodEnd, groupBy),
    queryFn: () =>
      apiFetch<PaymentsResponse>(
        `/api/reports/payments?periodStart=${periodStart}&periodEnd=${periodEnd}&groupBy=${groupBy}`
      ),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentsBreakdown(
  bucket: string | null,
  type: 'DIVIDEND' | 'INTEREST',
  groupBy: 'month' | 'quarter' | 'year',
) {
  const { periodStart, periodEnd } = useReportingPeriod();
  return useQuery({
    queryKey: reportsKeys.paymentsBreakdown(bucket, type, groupBy, periodStart, periodEnd),
    queryFn: () => {
      if (!bucket) throw new Error('bucket is required');
      return apiFetch<PaymentBreakdownResponse>(
        `/api/reports/payments/breakdown?bucket=${encodeURIComponent(bucket)}&type=${type}&groupBy=${groupBy}&periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
    },
    enabled: !!bucket,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
