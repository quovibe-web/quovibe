// packages/web/src/api/use-dashboards.ts — per-portfolio dashboard REST collection (ADR-015)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';

export interface DashboardItem {
  id: string;
  name: string;
  widgets: unknown[];
  columns: number;
  position: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export const dashboardsKeys = {
  all: (pid: string) => ['portfolios', pid, 'dashboards'] as const,
  item: (pid: string, id: string) => ['portfolios', pid, 'dashboards', id] as const,
};

export function useDashboards() {
  const api = useScopedApi();
  return useQuery({
    queryKey: dashboardsKeys.all(api.portfolioId),
    queryFn: () => api.fetch<DashboardItem[]>('/api/dashboards'),
  });
}

export function useDashboard(id: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: dashboardsKeys.item(api.portfolioId, id),
    queryFn: () => api.fetch<DashboardItem>(`/api/dashboards/${id}`),
    enabled: !!id,
  });
}

export function useCreateDashboard() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; widgets: unknown[]; columns: number }) =>
      api.fetch<DashboardItem>('/api/dashboards', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: dashboardsKeys.all(api.portfolioId) }); },
  });
}

export function useUpdateDashboard() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<DashboardItem> }) =>
      api.fetch<DashboardItem>(`/api/dashboards/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: dashboardsKeys.all(api.portfolioId) }); },
  });
}

export function useDeleteDashboard() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.fetch<void>(`/api/dashboards/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: dashboardsKeys.all(api.portfolioId) }); },
  });
}
