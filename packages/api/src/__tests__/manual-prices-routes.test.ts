// Integration tests for manual price CRUD routes:
//   GET    /api/p/:pid/securities/:id/prices           (raw, unfiltered)
//   POST   /api/p/:pid/securities/:id/prices           (upsert)
//   PUT    /api/p/:pid/securities/:id/prices/:date     (edit)
//   DELETE /api/p/:pid/securities/:id/prices/:date     (delete single)
//   DELETE /api/p/:pid/securities/:id/prices           (delete batch / all)
//   POST   /api/p/:pid/securities/:id/prices/derive    (derive from transactions)
//
// The raw GET deliberately bypasses the trading-day calendar filter so off-
// calendar manual prices are always visible (PP parity). The Saturday-date
// assertion pins this invariant.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-manual-prices-'));
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

async function makePortfolio(app: ReturnType<typeof import('../create-app').createApp>, name: string): Promise<string> {
  const r = await request(app).post('/api/portfolios').send({
    source: 'fresh',
    name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(r.status).toBe(201);
  return r.body.entry.id as string;
}

async function makeSecurity(app: ReturnType<typeof import('../create-app').createApp>, pid: string, currency = 'EUR'): Promise<string> {
  const r = await request(app).post(`/api/p/${pid}/securities`).send({ name: 'Test Sec', currency });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe('manual price routes', () => {
  it('POST adds a price and GET returns it unfiltered (weekend date survives)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'mp-1');
    const sid = await makeSecurity(app, pid);

    // 2025-03-15 is a Saturday — calendar filter would remove it; raw GET must not.
    const post = await request(app)
      .post(`/api/p/${pid}/securities/${sid}/prices`)
      .send({ date: '2025-03-15', value: '123.45' });
    expect(post.status, JSON.stringify(post.body)).toBe(200);

    const get = await request(app).get(`/api/p/${pid}/securities/${sid}/prices`);
    expect(get.status).toBe(200);
    expect(get.body.prices).toEqual([
      { date: '2025-03-15', value: '123.45', open: null, high: null, low: null, volume: null },
    ]);
  });

  it('POST rejects a non-positive value with 400', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'mp-2');
    const sid = await makeSecurity(app, pid);

    const post = await request(app)
      .post(`/api/p/${pid}/securities/${sid}/prices`)
      .send({ date: '2025-03-14', value: '0' });
    expect(post.status).toBe(400);
  });

  it('PUT edits, DELETE removes a single date', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'mp-3');
    const sid = await makeSecurity(app, pid);

    await request(app)
      .post(`/api/p/${pid}/securities/${sid}/prices`)
      .send({ date: '2025-03-14', value: '100' });

    const put = await request(app)
      .put(`/api/p/${pid}/securities/${sid}/prices/2025-03-14`)
      .send({ date: '2025-03-14', value: '150' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    // Verify edited value is reflected
    const getAfterEdit = await request(app).get(`/api/p/${pid}/securities/${sid}/prices`);
    expect(getAfterEdit.body.prices[0].value).toBe('150');

    const del = await request(app).delete(`/api/p/${pid}/securities/${sid}/prices/2025-03-14`);
    expect(del.status).toBe(200);

    const get = await request(app).get(`/api/p/${pid}/securities/${sid}/prices`);
    expect(get.body.prices).toEqual([]);
  });

  it('DELETE (no body) clears all', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'mp-4');
    const sid = await makeSecurity(app, pid);

    await request(app)
      .post(`/api/p/${pid}/securities/${sid}/prices`)
      .send({ date: '2025-01-01', value: '100' });
    await request(app)
      .post(`/api/p/${pid}/securities/${sid}/prices`)
      .send({ date: '2025-02-01', value: '200' });

    const del = await request(app)
      .delete(`/api/p/${pid}/securities/${sid}/prices`)
      .send({});
    expect(del.status).toBe(200);

    const get = await request(app).get(`/api/p/${pid}/securities/${sid}/prices`);
    expect(get.body.prices).toEqual([]);
  });

  it('POST derive returns {written, skipped}', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'mp-5');
    const sid = await makeSecurity(app, pid);

    const r = await request(app)
      .post(`/api/p/${pid}/securities/${sid}/prices/derive`)
      .send();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toHaveProperty('written');
    expect(r.body).toHaveProperty('skipped');
  });

  it('GET on unknown security returns 404', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'mp-6');

    const r = await request(app).get(
      `/api/p/${pid}/securities/00000000-0000-0000-0000-000000000000/prices`,
    );
    expect(r.status).toBe(404);
  });
});
