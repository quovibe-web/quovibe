// packages/api/src/services/dashboard-seed.ts
import type BetterSqlite3 from 'better-sqlite3';
import crypto from 'crypto';

const DEFAULT_WIDGETS = [
  { id: 'w-summary',  type: 'performance-summary',       title: null, span: 3, config: {} },
  { id: 'w-chart',    type: 'performance-chart',         title: null, span: 3, config: {} },
  { id: 'w-alloc',    type: 'asset-allocation-donut',    title: null, span: 1, config: {} },
  { id: 'w-top',      type: 'top-holdings',              title: null, span: 2, config: {} },
];

/**
 * Seed one default dashboard at position=0 in the given DB's vf_dashboard.
 * Called by createPortfolio for source='fresh' and source='import-pp-xml'
 * (demo already ships with dashboards baked into demo.db).
 * Idempotent: no-op if any dashboard already exists.
 */
export function seedDefaultDashboard(sqlite: BetterSqlite3.Database): void {
  const existing = sqlite.prepare('SELECT COUNT(*) as n FROM vf_dashboard').get() as { n: number };
  if (existing.n > 0) return;
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO vf_dashboard
       (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
     VALUES (?, ?, 0, ?, 1, 3, ?, ?)`,
  ).run(crypto.randomUUID(), 'Overview', JSON.stringify(DEFAULT_WIDGETS), now, now);
}
