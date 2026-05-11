import { z } from 'zod';

// Wire-body schemas for /api/p/:pid/dashboards CRUD endpoints (vf_dashboard
// SQL-table view).
//
// `columns` is the union of the literal 'auto' (grid auto-fill) and ints 2..5.
// vf_dashboard.columns is INTEGER NOT NULL on disk: the service translates
// 'auto' to the sentinel int 1 at the storage boundary. 1 is intentionally
// missing from this literal list — accepting it on the wire would let a
// caller smuggle a value indistinguishable from the encoded 'auto'.
//
// settings.schema.ts re-uses this same union for the sidecar-JSON
// `dashboardSchema.columns` so the two persistence formats share one source
// of truth for the legal value set.

export const dashboardColumnsValue = z.union([
  z.literal('auto'),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const dashboardWidgetWireSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().nullable().optional(),
  span: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  config: z.record(z.string(), z.unknown()).default({}),
  hidden: z.boolean().default(false),
});

export const createDashboardBodySchema = z.object({
  name: z.string().min(1).max(100),
  widgets: z.array(dashboardWidgetWireSchema).default([]),
  columns: dashboardColumnsValue.default('auto'),
});

export const updateDashboardBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  widgets: z.array(dashboardWidgetWireSchema).optional(),
  columns: dashboardColumnsValue.optional(),
  position: z.number().int().min(0).optional(),
});

export type DashboardColumns = z.infer<typeof dashboardColumnsValue>;
export type DashboardWidgetWire = z.infer<typeof dashboardWidgetWireSchema>;
export type CreateDashboardBody = z.infer<typeof createDashboardBodySchema>;
export type UpdateDashboardBody = z.infer<typeof updateDashboardBodySchema>;
