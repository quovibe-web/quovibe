// packages/api/src/services/__tests__/dashboard.service.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { getDashboard, createDashboard, updateDashboard, listDashboards } from '../dashboard.service';
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

describe('dashboard.service.updateDashboard — BUG-103 atomic position reshuffle', () => {
  function seedFour(sqlite: Database.Database): string[] {
    const rows = ['A', 'B', 'C', 'D'].map(name =>
      createDashboard(sqlite, { name, widgets: [], columns: 3 }),
    );
    expect(rows.map(r => r.position)).toEqual([0, 1, 2, 3]);
    return rows.map(r => r.id);
  }

  it('BUG-103 exact repro: PATCH position from 2→1 shifts sibling from 1→2; no duplicates', () => {
    const sqlite = freshSqlite();
    const [a, b, c, d] = seedFour(sqlite);
    // Repro: dashboard at position 2 moves to position 1. Pre-fix: server
    // wrote position=1 blindly and both C (pos=1 new) and B (pos=1 original)
    // held position 1 simultaneously.
    const updated = updateDashboard(sqlite, c, { position: 1 });
    expect(updated?.position).toBe(1);

    const positions = new Map(listDashboards(sqlite).map(x => [x.id, x.position]));
    expect(positions.get(a)).toBe(0);
    expect(positions.get(c)).toBe(1);
    expect(positions.get(b)).toBe(2);
    expect(positions.get(d)).toBe(3);
    // Invariant: no duplicate positions across any pair.
    const seen = new Set<number>();
    for (const p of positions.values()) {
      expect(seen.has(p)).toBe(false);
      seen.add(p);
    }
    sqlite.close();
  });

  it('moving down (0→3) shifts intervening siblings up by 1', () => {
    const sqlite = freshSqlite();
    const [a, b, c, d] = seedFour(sqlite);
    const updated = updateDashboard(sqlite, a, { position: 3 });
    expect(updated?.position).toBe(3);

    const positions = new Map(listDashboards(sqlite).map(x => [x.id, x.position]));
    expect(positions.get(b)).toBe(0);
    expect(positions.get(c)).toBe(1);
    expect(positions.get(d)).toBe(2);
    expect(positions.get(a)).toBe(3);
    sqlite.close();
  });

  it('moving up (3→0) shifts intervening siblings down by 1', () => {
    const sqlite = freshSqlite();
    const [a, b, c, d] = seedFour(sqlite);
    const updated = updateDashboard(sqlite, d, { position: 0 });
    expect(updated?.position).toBe(0);

    const positions = new Map(listDashboards(sqlite).map(x => [x.id, x.position]));
    expect(positions.get(d)).toBe(0);
    expect(positions.get(a)).toBe(1);
    expect(positions.get(b)).toBe(2);
    expect(positions.get(c)).toBe(3);
    sqlite.close();
  });

  it('target position clamped to maxPosition when client sends out-of-range value', () => {
    const sqlite = freshSqlite();
    const [a, b, c, d] = seedFour(sqlite);
    // Clamped to maxPosition=3 — full shift, a ends up at tail.
    const updated = updateDashboard(sqlite, a, { position: 999 });
    expect(updated?.position).toBe(3);

    const positions = new Map(listDashboards(sqlite).map(x => [x.id, x.position]));
    expect(positions.get(b)).toBe(0);
    expect(positions.get(c)).toBe(1);
    expect(positions.get(d)).toBe(2);
    expect(positions.get(a)).toBe(3);
    sqlite.close();
  });

  it('PATCH position === existing.position is a no-op (no sibling movement)', () => {
    const sqlite = freshSqlite();
    const [a, b, c, d] = seedFour(sqlite);
    const updated = updateDashboard(sqlite, c, { position: 2 });
    expect(updated?.position).toBe(2);

    const positions = new Map(listDashboards(sqlite).map(x => [x.id, x.position]));
    expect(positions.get(a)).toBe(0);
    expect(positions.get(b)).toBe(1);
    expect(positions.get(c)).toBe(2);
    expect(positions.get(d)).toBe(3);
    sqlite.close();
  });

  it('cascading multi-PATCH (simulating DnD move of head → tail) preserves uniqueness at every step', () => {
    const sqlite = freshSqlite();
    const [a, b, c, d] = seedFour(sqlite);
    // Client arrayMove(A, 0→3) → [B, C, D, A]. Dashboard.tsx multi-PATCHes
    // with final target indices keyed off ORIGINAL positions. Fire them in
    // the same order the client does and assert uniqueness holds throughout.
    const patches: Array<{ id: string; target: number }> = [
      { id: b, target: 0 },
      { id: c, target: 1 },
      { id: d, target: 2 },
      { id: a, target: 3 },
    ];
    for (const p of patches) {
      updateDashboard(sqlite, p.id, { position: p.target });
      const seen = new Set<number>();
      for (const row of listDashboards(sqlite)) {
        expect(seen.has(row.position), `duplicate position ${row.position} after PATCH`).toBe(false);
        seen.add(row.position);
      }
    }
    const positions = new Map(listDashboards(sqlite).map(x => [x.id, x.position]));
    expect(positions.get(b)).toBe(0);
    expect(positions.get(c)).toBe(1);
    expect(positions.get(d)).toBe(2);
    expect(positions.get(a)).toBe(3);
    sqlite.close();
  });

  it('PATCH that omits widgets preserves existing widgets_json (no re-serialize, no schema-version rewrite)', () => {
    const sqlite = freshSqlite();
    const now = new Date().toISOString();
    // Seed a legacy-schema row directly: schema_version=1 with a widget the
    // current codebase renames via widget-migrations. If updateDashboard
    // wrote back `JSON.stringify(existing.widgets)` it would clobber the
    // raw legacy JSON with the migrated shape.
    sqlite.prepare(
      `INSERT INTO vf_dashboard
         (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'legacy', 'Overview', 0,
      JSON.stringify([{ id: 'w1', type: 'performance-summary', span: 3, config: {} }]),
      1, 3, now, now,
    );

    updateDashboard(sqlite, 'legacy', { name: 'Renamed' });

    const raw = sqlite.prepare(
      'SELECT widgets_json, schema_version FROM vf_dashboard WHERE id = ?',
    ).get('legacy') as { widgets_json: string; schema_version: number };
    expect(JSON.parse(raw.widgets_json)).toEqual([
      { id: 'w1', type: 'performance-summary', span: 3, config: {} },
    ]);
    // schema_version still reflects prior commit semantics — the row bumps
    // to CURRENT_VERSION on any write. What must NOT change is the widget
    // payload (the COALESCE guard).
    expect(raw.schema_version).toBe(CURRENT_VERSION);
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
