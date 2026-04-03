import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { Dashboard } from '@quovibe/shared';

interface DashboardConfigResponse {
  dashboards: Dashboard[];
  activeDashboard: string | null;
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
};

/** Default empty dashboard injected client-side when server returns empty config */
function buildDefaultDashboard(): Dashboard {
  return {
    id: 'default',
    name: 'Dashboard',
    widgets: [],
  };
}

export function useDashboardConfig() {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => apiFetch<DashboardConfigResponse>('/api/dashboard'),
    placeholderData: keepPreviousData,
    select: (data) => {
      // Inject default dashboard if server returns empty
      if (data.dashboards.length === 0) {
        return {
          dashboards: [buildDefaultDashboard()],
          activeDashboard: 'default',
        };
      }
      return data;
    },
  });
}

export function useSaveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfigResponse) =>
      apiFetch<DashboardConfigResponse>('/api/dashboard', {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dashboardKeys.all }),
  });
}
