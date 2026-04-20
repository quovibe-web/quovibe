// packages/api/src/services/__tests__/dashboard.service.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { getDashboard, createDashboard } from '../dashboard.service';
import { CURRENT_VERSION } from '../widget-migrations';

function freshSqlite(): Database.Database {
  const db = new Database(':memory:');
  applyBootstrap(db);
  return db;
}

describe('dashboard.service.rowToItem — forward-compat guard', () => {
  it('returns widgets = [] when schema_version > CURRENT_VERSION and widgets_json is a non-array object', () => {
    const sqlite = freshSqlite();

    // Write a row with a future schema_version and an object-shaped widgets_json
    // (the shape a future migration might introduce). Pre-guard code called
    // `widgets.map(...)` on this and threw a TypeError — post-guard code
    // surfaces an empty array sentinel instead.
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO vf_dashboard
         (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('future-dash', 'Future', 0, '{"key":"not-an-array"}', 99, 3, now, now);

    const item = getDashboard(sqlite, 'future-dash');
    expect(item).not.toBeNull();
    expect(item!.widgets).toEqual([]);
    expect(item!.schemaVersion).toBe(99);
    sqlite.close();
  });

  it('still maps each widget to unsupported-widget when schema_version > CURRENT_VERSION and widgets_json is an array', () => {
    const sqlite = freshSqlite();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO vf_dashboard
         (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('future-arr', 'FutureArr', 0,
      JSON.stringify([{ id: 'w1', type: 'future-kind', config: { foo: 1 } }]),
      99, 3, now, now);

    const item = getDashboard(sqlite, 'future-arr');
    expect(item).not.toBeNull();
    expect(item!.widgets).toHaveLength(1);
    const w = item!.widgets[0] as { type: string; __originalType: string; config: { foo: number } };
    expect(w.type).toBe('unsupported-widget');
    expect(w.__originalType).toBe('future-kind');
    expect(w.config).toEqual({ foo: 1 });
    sqlite.close();
  });

  it('passes through current-version rows untouched (sanity check that the guard only fires on sv > CURRENT)', () => {
    const sqlite = freshSqlite();
    const created = createDashboard(sqlite, {
      name: 'Now',
      widgets: [{ id: 'w1', type: 'summary' }],
      columns: 3,
    });
    expect(created.schemaVersion).toBe(CURRENT_VERSION);
    expect(created.widgets).toHaveLength(1);
    const w = created.widgets[0] as { type: string };
    expect(w.type).toBe('summary');
    sqlite.close();
  });
});

describe('dashboard.service.getDashboard — BUG-91 legacy rows heal on read', () => {
  it('a schema_version=1 row with the legacy DEFAULT_WIDGETS seed returns migrated widget types', () => {
    const sqlite = freshSqlite();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO vf_dashboard
         (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'legacy-ovw', 'Overview', 0,
      JSON.stringify([
        { id: 'w-summary', type: 'performance-summary',    title: null, span: 3, config: {} },
        { id: 'w-chart',   type: 'performance-chart',      title: null, span: 3, config: {} },
        { id: 'w-alloc',   type: 'asset-allocation-donut', title: null, span: 1, config: {} },
        { id: 'w-top',     type: 'top-holdings',           title: null, span: 2, config: {} },
      ]),
      1, 3, now, now,
    );

    const item = getDashboard(sqlite, 'legacy-ovw');
    expect(item).not.toBeNull();
    // schemaVersion is still 1 on disk (migration-on-read is in memory) but widgets are migrated
    expect(item!.schemaVersion).toBe(1);
    const types = (item!.widgets as Array<{ type: string }>).map(w => w.type);
    expect(types).toEqual(['market-value', 'perf-chart', 'top-holdings']);
    sqlite.close();
  });
});
