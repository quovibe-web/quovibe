// packages/api/src/__tests__/exchange-rates-lazy-fetch.test.ts
//
// Regression harness for BUG-135: GET /api/p/:pid/prices/exchange-rates
// returned 404 on cache miss with no lazy-fetch fallback. The route now
// calls fetchSinglePairOnDemand on miss for non-demo portfolios, populating
// vf_exchange_rate from ECB or Yahoo before re-querying.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-fx-lazy-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;

const fetchSinglePairMock = vi.fn();

vi.mock('../services/fx-fetcher.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/fx-fetcher.service')>();
  return {
    ...actual,
    fetchSinglePairOnDemand: (...args: unknown[]) => fetchSinglePairMock(...args),
  };
});

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

async function freshPortfolio(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const r = await request(app).post('/api/portfolios').send({
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(r.status).toBe(201);
  return r.body.entry.id as string;
}

async function withDb(pid: string, fn: (sqlite: BetterSqlite3.Database) => void): Promise<void> {
  const { acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool');
  const h = acquirePortfolioDb(pid);
  try {
    fn(h.sqlite);
  } finally {
    releasePortfolioDb(pid);
  }
}

describe('GET /api/p/:pid/prices/exchange-rates lazy fetch (BUG-135)', () => {
  it('cache hit: returns 200 without invoking fetchSinglePairOnDemand', async () => {
    fetchSinglePairMock.mockReset();
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, `FX-LAZY-1-${Date.now()}`);

    await withDb(pid, (sqlite) => {
      sqlite.prepare(
        `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
         VALUES (?, ?, ?, ?)`,
      ).run('2026-04-27', 'EUR', 'USD', '1.07');
    });

    const res = await request(app)
      .get(`/api/p/${pid}/prices/exchange-rates`)
      .query({ from: 'EUR', to: 'USD', date: '2026-04-27' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'EUR', to: 'USD', date: '2026-04-27', rate: '1.07' });
    expect(fetchSinglePairMock).not.toHaveBeenCalled();
  });

  it('cache miss + upstream success: calls fetchSinglePairOnDemand, returns 200', async () => {
    fetchSinglePairMock.mockReset();
    fetchSinglePairMock.mockImplementation(async (sqlite: BetterSqlite3.Database) => {
      sqlite.prepare(
        `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
         VALUES (?, ?, ?, ?)`,
      ).run('2026-04-27', 'EUR', 'USD', '1.0850');
    });

    const app = createApp();
    const pid = await freshPortfolio(app, `FX-LAZY-2-${Date.now()}`);

    const res = await request(app)
      .get(`/api/p/${pid}/prices/exchange-rates`)
      .query({ from: 'EUR', to: 'USD', date: '2026-04-27' });

    expect(res.status).toBe(200);
    expect(res.body.rate).toBe('1.085');
    expect(fetchSinglePairMock).toHaveBeenCalledTimes(1);
  });

  it('cache miss + upstream failure: 404 surfaced, fetchSinglePairOnDemand attempted', async () => {
    fetchSinglePairMock.mockReset();
    fetchSinglePairMock.mockResolvedValue(undefined);

    const app = createApp();
    const pid = await freshPortfolio(app, `FX-LAZY-3-${Date.now()}`);

    const res = await request(app)
      .get(`/api/p/${pid}/prices/exchange-rates`)
      .query({ from: 'EUR', to: 'USD', date: '2026-04-27' });

    expect(res.status).toBe(404);
    expect(fetchSinglePairMock).toHaveBeenCalledTimes(1);
  });

  it('demo portfolio + cache miss: 404, fetchSinglePairOnDemand NOT called', async () => {
    fetchSinglePairMock.mockReset();

    const app = createApp();
    const r = await request(app).post('/api/portfolios').send({ source: 'demo' });
    expect(r.status).toBe(201);
    const pid = r.body.entry.id as string;

    const res = await request(app)
      .get(`/api/p/${pid}/prices/exchange-rates`)
      .query({ from: 'EUR', to: 'USD', date: '2026-04-27' });

    expect(res.status).toBe(404);
    expect(fetchSinglePairMock).not.toHaveBeenCalled();
  });

  it('missing query param: 400 (regression pin)', async () => {
    fetchSinglePairMock.mockReset();
    const app = createApp();
    const pid = await freshPortfolio(app, `FX-LAZY-5-${Date.now()}`);

    const res = await request(app)
      .get(`/api/p/${pid}/prices/exchange-rates`)
      .query({ to: 'USD', date: '2026-04-27' });

    expect(res.status).toBe(400);
    expect(fetchSinglePairMock).not.toHaveBeenCalled();
  });
});
