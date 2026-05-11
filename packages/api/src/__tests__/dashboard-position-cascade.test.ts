// Regression harness for BUG-103: PATCH /api/p/:pid/dashboards/:id {position}
// blindly wrote the new position onto vf_dashboard without shifting siblings,
// leaving the portfolio with two dashboards sharing the same position. The
// fix is an atomic reshuffle in updateDashboard (service layer). Any
// regression that removes the cascade will fail these tests.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-dashboard-pos-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
  ({ createApp } = await import('../create-app'));
  ({ loadSettings } = await import('../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../services/boot-recovery'));
  await import('../services/portfolio-registry');
});

function freshBody(name: string): Record<string, unknown> {
  return {
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  };
}

describe('PATCH /api/p/:pid/dashboards/:id {position} (BUG-103)', () => {
  it('PATCH position into an occupied slot shifts the sibling out; no duplicate positions', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const portfolio = await request(app).post('/api/portfolios').send(freshBody('PosAlpha'));
    expect(portfolio.status).toBe(201);
    const pid = portfolio.body.entry.id;

    const mk = async (name: string) =>
      request(app).post(`/api/p/${pid}/dashboards`).send({ name, widgets: [], columns: 3 });
    // The fresh portfolio seed creates one default dashboard at position 0, so
    // our user-created dashboards land at positions 1..4. The reshuffle math
    // is position-agnostic; we just need 4+ rows to repro the cascade.
    const d0 = await mk('A');
    const d1 = await mk('B');
    const d2 = await mk('C');
    const d3 = await mk('D');
    const basePos = d0.body.position;
    expect([d1.body.position, d2.body.position, d3.body.position])
      .toEqual([basePos + 1, basePos + 2, basePos + 3]);

    // BUG-103 repro: PATCH d2 into d1's slot (basePos+1). Pre-fix, server
    // returned `{position: basePos+1}` and GET listed d1 AND d2 both there.
    const target = basePos + 1;
    const moved = await request(app)
      .patch(`/api/p/${pid}/dashboards/${d2.body.id}`)
      .send({ position: target });
    expect(moved.status).toBe(200);
    expect(moved.body.position).toBe(target);

    const list = await request(app).get(`/api/p/${pid}/dashboards`);
    expect(list.status).toBe(200);
    const byId = new Map<string, number>(
      (list.body as Array<{ id: string; position: number }>).map(d => [d.id, d.position]),
    );
    expect(byId.get(d0.body.id)).toBe(basePos);
    expect(byId.get(d2.body.id)).toBe(basePos + 1);
    expect(byId.get(d1.body.id)).toBe(basePos + 2);
    expect(byId.get(d3.body.id)).toBe(basePos + 3);

    // No duplicates across the whole set (includes the seed dashboard).
    const positions = Array.from(byId.values());
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('full DnD simulation: move head → tail via 4 sequential PATCHes produces unique positions at every step', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const portfolio = await request(app).post('/api/portfolios').send(freshBody('PosBravo'));
    const pid = portfolio.body.entry.id;
    const mk = async (name: string) =>
      (await request(app).post(`/api/p/${pid}/dashboards`).send({ name, widgets: [], columns: 3 })).body;
    const a = await mk('A');
    const b = await mk('B');
    const c = await mk('C');
    const d = await mk('D');

    // Client: arrayMove(a, 0→3) → [b, c, d, a]. Multi-PATCH with target indices
    // keyed off original positions. Server must produce unique positions after
    // each one.
    const patches: Array<{ id: string; target: number }> = [
      { id: b.id, target: 0 },
      { id: c.id, target: 1 },
      { id: d.id, target: 2 },
      { id: a.id, target: 3 },
    ];
    for (const p of patches) {
      const r = await request(app)
        .patch(`/api/p/${pid}/dashboards/${p.id}`)
        .send({ position: p.target });
      expect(r.status).toBe(200);
      const list = await request(app).get(`/api/p/${pid}/dashboards`);
      const positions = (list.body as Array<{ position: number }>).map(x => x.position);
      expect(new Set(positions).size, `duplicate positions after PATCH of ${p.id}`).toBe(positions.length);
    }

    const final = await request(app).get(`/api/p/${pid}/dashboards`);
    const byId = new Map<string, number>(
      (final.body as Array<{ id: string; position: number }>).map(x => [x.id, x.position]),
    );
    expect(byId.get(b.id)).toBe(0);
    expect(byId.get(c.id)).toBe(1);
    expect(byId.get(d.id)).toBe(2);
    expect(byId.get(a.id)).toBe(3);
  });
});
