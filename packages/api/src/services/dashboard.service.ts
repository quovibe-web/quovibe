// packages/api/src/services/dashboard.service.ts
// Phase 3c stub — thin CRUD over vf_dashboard. Phase 4 extends with widget migrations.
import type BetterSqlite3 from 'better-sqlite3';
import crypto from 'crypto';
import { CURRENT_VERSION, upgradeWidgets } from './widget-migrations';

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

function rowToItem(row: Record<string, unknown>): DashboardItem {
  const sv = row.schema_version as number;
  let widgets = JSON.parse(row.widgets_json as string);
  if (sv < CURRENT_VERSION) widgets = upgradeWidgets(widgets, sv);
  else if (sv > CURRENT_VERSION) widgets = widgets.map((w: { type: string }) =>
    ({ ...w, type: 'unsupported-widget', __originalType: w.type }));
  return {
    id: row.id as string,
    name: row.name as string,
    widgets,
    columns: row.columns as number,
    position: row.position as number,
    schemaVersion: sv,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export function listDashboards(sqlite: BetterSqlite3.Database): DashboardItem[] {
  return (sqlite.prepare('SELECT * FROM vf_dashboard ORDER BY position ASC')
    .all() as Record<string, unknown>[])
    .map(rowToItem);
}

export function getDashboard(sqlite: BetterSqlite3.Database, id: string): DashboardItem | null {
  const row = sqlite.prepare('SELECT * FROM vf_dashboard WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToItem(row) : null;
}

export function createDashboard(
  sqlite: BetterSqlite3.Database,
  input: { name: string; widgets: unknown[]; columns: number },
): DashboardItem {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const position = ((sqlite.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM vf_dashboard')
    .get() as { p: number }).p);
  sqlite.prepare(
    `INSERT INTO vf_dashboard
       (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, position, JSON.stringify(input.widgets), CURRENT_VERSION, input.columns, now, now);
  return getDashboard(sqlite, id)!;
}

export function updateDashboard(
  sqlite: BetterSqlite3.Database,
  id: string,
  input: { name?: string; widgets?: unknown[]; columns?: number; position?: number },
): DashboardItem | null {
  const existing = getDashboard(sqlite, id);
  if (!existing) return null;
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE vf_dashboard SET
       name = ?, widgets_json = ?, schema_version = ?, columns = ?, position = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    JSON.stringify(input.widgets ?? existing.widgets),
    CURRENT_VERSION,                    // persist at current shape
    input.columns ?? existing.columns,
    input.position ?? existing.position,
    now,
    id,
  );
  return getDashboard(sqlite, id);
}

export function deleteDashboard(sqlite: BetterSqlite3.Database, id: string): boolean {
  const r = sqlite.prepare('DELETE FROM vf_dashboard WHERE id = ?').run(id);
  return r.changes > 0;          // native-ok
}
