// packages/api/src/__tests__/multi-portfolio-concurrency.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-mpc-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
// Force pool eviction under load: with 2 real portfolios and cap=1, every
// interleaved request against the "other" portfolio must acquire + release
// through a cold-miss open. Stresses acquire/release refcount correctness
// in a way the default cap=5 cannot.
process.env.PORTFOLIO_POOL_MAX = '1';

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;
let acquirePortfolioDb: typeof import('../services/portfolio-db-pool').acquirePortfolioDb;
let releasePortfolioDb: typeof import('../services/portfolio-db-pool').releasePortfolioDb;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));

  // Seed a minimal demo source so boot-recovery won't trip looking for one.
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
  ({ acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool'));
});

describe('multi-portfolio concurrency', () => {
  it('interleaved requests to /api/p/A/* and /api/p/B/* return per-portfolio data', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    // Create 2 portfolios
    const r1 = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'A' });
    const r2 = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'B' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const idA = r1.body.entry.id;
    const idB = r2.body.entry.id;

    // Seed each with a distinguishing account (portfolio-specific UUID so we can tell them apart).
    for (const [id, label] of [[idA, 'A-acc'], [idB, 'B-acc']] as const) {
      const h = acquirePortfolioDb(id);
      h.sqlite.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order)
         VALUES (1, ?, ?, 'EUR', 'account', '2026-01-01T00:00:00Z', 0, 0)`,
      ).run(label, label);
      releasePortfolioDb(id);
    }

    // Fire 100 interleaved requests
    const hits: Array<{ scope: 'A' | 'B'; names: string[] }> = [];
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      const scope: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
      const id = scope === 'A' ? idA : idB;
      promises.push(
        request(app).get(`/api/p/${id}/accounts`).then((r) => {
          hits.push({ scope, names: (r.body as { name: string }[]).map((x) => x.name) });
        }),
      );
    }
    await Promise.all(promises);

    expect(hits.length).toBe(100);
    // Every A-hit returned only A-acc; every B-hit returned only B-acc.
    for (const h of hits) {
      if (h.scope === 'A') expect(h.names).toEqual(['A-acc']);
      else expect(h.names).toEqual(['B-acc']);
    }
  });
});
