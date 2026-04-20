// packages/api/src/services/dashboard-seed.ts
import type BetterSqlite3 from 'better-sqlite3';
import crypto from 'crypto';
import { DEFAULT_DASHBOARD_WIDGETS } from '@quovibe/shared';
import { CURRENT_VERSION } from './widget-migrations';

/**
 * Seed one default dashboard at position=0 in the given DB's vf_dashboard.
 * Called by createPortfolio for source='fresh' and source='import-pp-xml'
 * (demo already ships with dashboards baked into demo.db).
 * Idempotent: no-op if any dashboard already exists.
 *
 * Widget type strings come from the canonical shared constant so seeding is
 * locked in step with the web widget-registry (BUG-91).
 */
export function seedDefaultDashboard(sqlite: BetterSqlite3.Database): void {
  const existing = sqlite.prepare('SELECT COUNT(*) as n FROM vf_dashboard').get() as { n: number };
  if (existing.n > 0) return;
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO vf_dashboard
       (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
     VALUES (?, ?, 0, ?, ?, 3, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    'Overview',
    JSON.stringify(DEFAULT_DASHBOARD_WIDGETS),
    CURRENT_VERSION,
    now,
    now,
  );
}
