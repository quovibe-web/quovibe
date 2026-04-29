// packages/api/src/services/__tests__/dashboard-seed.test.ts
// BUG-91: seedDefaultDashboard must produce a dashboard whose widget types
// all exist in the current registry AND whose schema_version is the current
// one (so the row never looks legacy to the migration-on-read path).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { seedDefaultDashboard } from '../dashboard-seed';
import { CURRENT_VERSION } from '../widget-migrations';
import { DEFAULT_DASHBOARD_WIDGETS } from '@quovibe/shared';

function freshSqlite(): Database.Database {
  const db = new Database(':memory:');
  applyBootstrap(db);
  return db;
}

describe('seedDefaultDashboard (BUG-91)', () => {
  it('seeds exactly one Overview dashboard at position 0', () => {
    const sqlite = freshSqlite();
    seedDefaultDashboard(sqlite);
    const rows = sqlite.prepare(
      'SELECT id, name, position, schema_version, widgets_json, columns FROM vf_dashboard ORDER BY position ASC',
    ).all() as Array<{ id: string; name: string; position: number; schema_version: number; widgets_json: string; columns: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Overview');
    expect(rows[0].position).toBe(0);
    expect(rows[0].columns).toBe(3);
    sqlite.close();
  });

  it('writes schema_version = CURRENT_VERSION (not a literal 1)', () => {
    const sqlite = freshSqlite();
    seedDefaultDashboard(sqlite);
    const row = sqlite.prepare('SELECT schema_version FROM vf_dashboard').get() as { schema_version: number };
    expect(row.schema_version).toBe(CURRENT_VERSION);
    sqlite.close();
  });

  it('seeded widgets match the shared DEFAULT_DASHBOARD_WIDGETS constant', () => {
    const sqlite = freshSqlite();
    seedDefaultDashboard(sqlite);
    const row = sqlite.prepare('SELECT widgets_json FROM vf_dashboard').get() as { widgets_json: string };
    const widgets = JSON.parse(row.widgets_json) as Array<{ type: string; span: number }>;
    expect(widgets.map(w => w.type)).toEqual(DEFAULT_DASHBOARD_WIDGETS.map(w => w.type));
    expect(widgets.map(w => w.span)).toEqual(DEFAULT_DASHBOARD_WIDGETS.map(w => w.span));
    sqlite.close();
  });

  it('is idempotent: a second call with an existing dashboard is a no-op', () => {
    const sqlite = freshSqlite();
    seedDefaultDashboard(sqlite);
    const firstCount = (sqlite.prepare('SELECT COUNT(*) as n FROM vf_dashboard').get() as { n: number }).n;
    seedDefaultDashboard(sqlite);
    const secondCount = (sqlite.prepare('SELECT COUNT(*) as n FROM vf_dashboard').get() as { n: number }).n;
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);
    sqlite.close();
  });

  it('does not seed any widget type that was removed from the registry in BUG-91', () => {
    const sqlite = freshSqlite();
    seedDefaultDashboard(sqlite);
    const row = sqlite.prepare('SELECT widgets_json FROM vf_dashboard').get() as { widgets_json: string };
    const types = (JSON.parse(row.widgets_json) as Array<{ type: string }>).map(w => w.type);
    for (const dead of ['performance-summary', 'performance-chart', 'asset-allocation-donut']) {
      expect(types).not.toContain(dead);
    }
    sqlite.close();
  });
});
