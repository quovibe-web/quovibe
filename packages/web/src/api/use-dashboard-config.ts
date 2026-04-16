// packages/web/src/api/use-dashboard-config.ts
//
// Legacy compatibility shim over the new per-portfolio dashboard REST collection
// (ADR-015). Existing consumers (Dashboard page, WidgetShell, DataSeriesDialog,
// PeriodOverrideDialog) expect the old `{ dashboards, activeDashboard }` shape;
// this file adapts them to the new `/api/dashboards` collection until Phase 5b
// reworks those pages directly.
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { Dashboard } from '@quovibe/shared';

interface DashboardConfigResponse {
  dashboards: Dashboard[];
  activeDashboard: string | null;
}

interface DashboardRestItem {
  id: string;
  name: string;
  widgets: unknown[];
  columns: number;
  position: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export const dashboardKeys = {
  all: (pid: string) => ['portfolios', pid, 'dashboards'] as const,
};

/** Default empty dashboard injected client-side when the collection is empty */
function buildDefaultDashboard(): Dashboard {
  return {
    id: 'default',
    name: 'Dashboard',
    widgets: [],
    columns: 'auto',
  } as unknown as Dashboard;
}

function adaptRestToLegacy(items: DashboardRestItem[]): DashboardConfigResponse {
  if (items.length === 0) {
    return { dashboards: [buildDefaultDashboard()], activeDashboard: 'default' };
  }
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return {
    dashboards: sorted.map((it) => ({
      id: it.id,
      name: it.name,
      widgets: it.widgets,
      columns: it.columns,
    }) as unknown as Dashboard),
    activeDashboard: sorted[0].id,
  };
}

export function useDashboardConfig() {
  const api = useScopedApi();
  return useQuery({
    queryKey: dashboardKeys.all(api.portfolioId),
    queryFn: () => api.fetch<DashboardRestItem[]>('/api/dashboards'),
    placeholderData: keepPreviousData,
    select: adaptRestToLegacy,
  });
}

/**
 * Save by rewriting the entire collection: update existing items by id, create
 * any that are missing (best-effort). Legacy consumers replace the whole config
 * on every save, so we reconcile item-by-item against the current collection.
 */
export function useSaveDashboard() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: DashboardConfigResponse) => {
      // Fetch current items to decide which are creates vs updates
      const current = await api.fetch<DashboardRestItem[]>('/api/dashboards');
      const byId = new Map(current.map((it) => [it.id, it]));

      const dashboards = config.dashboards ?? [];
      for (let i = 0; i < dashboards.length; i++) { // native-ok (array index)
        const d = dashboards[i];
        const payload = {
          name: d.name,
          widgets: (d as unknown as { widgets?: unknown[] }).widgets ?? [],
          columns: (d as unknown as { columns?: number }).columns ?? 3,
          position: i,
        };
        if (byId.has(d.id) && d.id !== 'default') {
          await api.fetch(`/api/dashboards/${d.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        } else {
          await api.fetch('/api/dashboards', { method: 'POST', body: JSON.stringify(payload) });
        }
      }
      return config;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dashboardKeys.all(api.portfolioId) }),
  });
}
