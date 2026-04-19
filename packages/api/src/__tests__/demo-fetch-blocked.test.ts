// packages/api/src/__tests__/demo-fetch-blocked.test.ts
// BUG-43 follow-up: demo portfolios must reject live price fetches so that
// Yahoo data cannot overwrite the tail of the seeded random walk and create a
// visible discontinuity between seeded and live segments.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-dfb-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;
let closeAllPooledHandles: typeof import('../services/portfolio-db-pool').closeAllPooledHandles;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));

  // Seed a demo source with one security so price-fetch routes have something to target.
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo Portfolio')");
    db.prepare(
      `INSERT INTO security (uuid, name, currency, feed, feedTickerSymbol, isRetired, updatedAt)
       VALUES (?, ?, 'EUR', 'YAHOO', 'VWCE.DE', 0, ?)`,
    ).run(
      '11111111-1111-4111-8111-111111111111',
      'Vanguard FTSE All-World',
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }

  ({ createApp } = await import('../create-app'));
  ({ loadSettings } = await import('../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../services/boot-recovery'));
  ({ closeAllPooledHandles } = await import('../services/portfolio-db-pool'));
  await import('../services/portfolio-registry');
});

beforeEach(() => {
  closeAllPooledHandles();
  const sc = path.join(tmp, 'quovibe.settings.json');
  if (fs.existsSync(sc)) fs.unlinkSync(sc);
  for (const f of fs.readdirSync(tmp)) {
    if ((f.startsWith('portfolio-') && f.endsWith('.db')) || f.endsWith('.db-shm') || f.endsWith('.db-wal')) {
      try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ignore lock residue */ }
    }
  }
  loadSettings();
  recoverFromInterruptedSwap();
});

describe('demo portfolio rejects live price fetches', () => {
  it('POST /api/p/:pid/prices/fetch-all returns 403 DEMO_PORTFOLIO_FETCH_BLOCKED', async () => {
    const app = createApp();
    const create = await request(app).post('/api/portfolios').send({ source: 'demo' });
    expect(create.status).toBe(201);
    const demoId = create.body.entry.id;

    const res = await request(app).post(`/api/p/${demoId}/prices/fetch-all`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('DEMO_PORTFOLIO_FETCH_BLOCKED');
  });

  it('PUT /api/p/:pid/securities/:id/prices/fetch returns 403 DEMO_PORTFOLIO_FETCH_BLOCKED', async () => {
    const app = createApp();
    const create = await request(app).post('/api/portfolios').send({ source: 'demo' });
    expect(create.status).toBe(201);
    const demoId = create.body.entry.id;

    const res = await request(app)
      .put(`/api/p/${demoId}/securities/11111111-1111-4111-8111-111111111111/prices/fetch`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('DEMO_PORTFOLIO_FETCH_BLOCKED');
  });

  it('real portfolios are not affected by the demo guard', async () => {
    const app = createApp();
    const create = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Real' });
    expect(create.status).toBe(201);
    const realId = create.body.entry.id;

    const res = await request(app).post(`/api/p/${realId}/prices/fetch-all`);
    // Real portfolio reaches the fetch logic — may 200 (no securities → empty result)
    // or 500 (live network). Either way, it must NOT be 403 DEMO_PORTFOLIO_FETCH_BLOCKED.
    expect(res.status).not.toBe(403);
    if (res.body?.error) {
      expect(res.body.error).not.toBe('DEMO_PORTFOLIO_FETCH_BLOCKED');
    }
  });
});
