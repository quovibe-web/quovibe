// packages/web/src/api/use-dashboards.ts — per-portfolio dashboard REST collection (ADR-015)
import { useQuery } from '@tanstack/react-query';
import type { DashboardColumns } from '@quovibe/shared';
import { useScopedApi } from './use-scoped-api';
import {
  useEntityMutations,
  entityListKey,
  entityItemKey,
} from './use-entity-mutations';

export type { DashboardColumns };

export interface DashboardItem {
  id: string;
  name: string;
  widgets: unknown[];
  columns: DashboardColumns;
  position: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export const dashboardsKeys = {
  all: (pid: string) => entityListKey(pid, 'dashboards'),
  item: (pid: string, id: string) => entityItemKey(pid, 'dashboards', id),
};

type DashboardCreateInput = { name: string; widgets: unknown[]; columns: DashboardColumns };
type DashboardUpdateInput = Partial<DashboardItem>;

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
  const { create } = useEntityMutations<DashboardItem, DashboardCreateInput, DashboardUpdateInput>({
    entity: 'dashboards',
  });
  return create;
}

export function useUpdateDashboard() {
  const { update } = useEntityMutations<DashboardItem, DashboardCreateInput, DashboardUpdateInput>({
    entity: 'dashboards',
  });
  return update;
}

export function useDeleteDashboard() {
  const { remove } = useEntityMutations<DashboardItem, DashboardCreateInput, DashboardUpdateInput>({
    entity: 'dashboards',
  });
  return remove;
}
