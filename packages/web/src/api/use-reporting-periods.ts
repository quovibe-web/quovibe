import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { ReportingPeriodDef } from '@quovibe/shared';

interface ResolvedPeriod {
  definition: ReportingPeriodDef;
  resolved: { periodStart: string; periodEnd: string };
}

interface ReportingPeriodsResponse {
  periods: ResolvedPeriod[];
}

interface MutationPeriodsResponse {
  periods: ReportingPeriodDef[];
}

export const reportingPeriodKeys = {
  all: ['reporting-periods'] as const,
};

export function useReportingPeriods() {
  return useQuery({
    queryKey: reportingPeriodKeys.all,
    queryFn: () => apiFetch<ReportingPeriodsResponse>('/api/settings/reporting-periods'),
  });
}

export function useCreateReportingPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (period: ReportingPeriodDef) =>
      apiFetch<MutationPeriodsResponse>('/api/settings/reporting-periods', {
        method: 'POST',
        body: JSON.stringify(period),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportingPeriodKeys.all }),
  });
}

export function useDeleteReportingPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (index: number) =>
      apiFetch<MutationPeriodsResponse>(`/api/settings/reporting-periods/${index}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportingPeriodKeys.all }),
  });
}

export function useReorderReportingPeriods() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periods: ReportingPeriodDef[]) =>
      apiFetch<MutationPeriodsResponse>('/api/settings/reporting-periods', {
        method: 'PUT',
        body: JSON.stringify(periods),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportingPeriodKeys.all }),
  });
}
