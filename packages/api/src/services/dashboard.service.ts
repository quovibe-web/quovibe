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
  else if (sv > CURRENT_VERSION) {
    // Future schema versions may change the widgets_json shape (e.g. object-keyed
    // map instead of array). Guard against non-array so rowToItem cannot throw
    // when rendering a forward-compat sentinel — callers see an empty widget list.
    widgets = Array.isArray(widgets)
      ? widgets.map((w: { type: string }) =>
          ({ ...w, type: 'unsupported-widget', __originalType: w.type }))
      : [];
  }
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

  // BUG-103: position PATCH must atomically reshuffle siblings to preserve
  // uniqueness. Without the cascade, a blind write creates duplicate positions
  // (repro: three dashboards at 0/1/2, PATCH id2 to 1 → two rows at position 1).
  // Clamp target into [0, maxPosition] so a malformed client payload can't
  // create gaps.
  const txn = sqlite.transaction(() => {
    let newPos = existing.position;
    if (input.position !== undefined && input.position !== existing.position) {
      const maxPos = (sqlite.prepare(
        'SELECT COALESCE(MAX(position), 0) AS m FROM vf_dashboard',
      ).get() as { m: number }).m;
      newPos = Math.max(0, Math.min(input.position, maxPos));
      if (newPos !== existing.position) {
        if (existing.position < newPos) {
          sqlite.prepare(
            `UPDATE vf_dashboard SET position = position - 1
             WHERE position > ? AND position <= ? AND id != ?`,
          ).run(existing.position, newPos, id);
        } else {
          sqlite.prepare(
            `UPDATE vf_dashboard SET position = position + 1
             WHERE position >= ? AND position < ? AND id != ?`,
          ).run(newPos, existing.position, id);
        }
      }
    }
    // widgets_json is `COALESCE(?, widgets_json)` so a rename/position PATCH
    // doesn't re-serialize the existing widget tree (and doesn't silently
    // rewrite a legacy-seed row with its in-memory-migrated shape).
    sqlite.prepare(
      `UPDATE vf_dashboard SET
         name = ?,
         widgets_json = COALESCE(?, widgets_json),
         schema_version = ?,
         columns = ?,
         position = ?,
         updatedAt = ?
       WHERE id = ?`,
    ).run(
      input.name ?? existing.name,
      input.widgets === undefined ? null : JSON.stringify(input.widgets),
      CURRENT_VERSION,
      input.columns ?? existing.columns,
      newPos,
      now,
      id,
    );
  });
  txn();
  return getDashboard(sqlite, id);
}

export function deleteDashboard(sqlite: BetterSqlite3.Database, id: string): boolean {
  const r = sqlite.prepare('DELETE FROM vf_dashboard WHERE id = ?').run(id);
  return r.changes > 0;          // native-ok
}
