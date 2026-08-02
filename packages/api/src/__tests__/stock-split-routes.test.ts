// Integration tests for the stock split routes:
//   POST /api/p/:pid/securities/:sid/split/preview
//   POST /api/p/:pid/securities/:sid/split
//
// The mount sits under the securities router's prefix but declares no
// conflicting path, so these cases also pin that the request reaches the split
// handlers rather than being swallowed by `/:id`.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-stock-split-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;
let acquirePortfolioDb: typeof import('../services/portfolio-db-pool').acquirePortfolioDb;
let releasePortfolioDb: typeof import('../services/portfolio-db-pool').releasePortfolioDb;

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
  ({ acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool'));
});

const EX_DATE = '2026-07-16';
const UNKNOWN_SECURITY = '99999999-9999-4999-8999-999999999999';

async function setup(): Promise<{
  app: ReturnType<typeof createApp>;
  pid: string;
  secId: string;
}> {
  loadSettings();
  recoverFromInterruptedSwap();
  const app = createApp();

  const rP = await request(app).post('/api/portfolios').send({
    source: 'fresh',
    name: `Split Test ${Math.random().toString(36).slice(2)}`,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main',
    primaryDeposit: { name: 'Cash' },
  });
  expect(rP.status).toBe(201);
  const pid = rP.body.entry.id as string;

  const rS = await request(app)
    .post(`/api/p/${pid}/securities`)
    .send({ name: 'Amper', currency: 'EUR' });
  expect(rS.status).toBe(201);
  const secId = rS.body.id as string;

  return { app, pid, secId };
}

/** Seed a securities-side BUY dated before the ex-date, plus one quote. */
function seedTradeAndQuote(pid: string, secId: string, shareCount: number, close: number): void {
  const h = acquirePortfolioDb(pid);
  try {
    const acc = h.sqlite
      .prepare(`SELECT uuid FROM account WHERE type = 'portfolio' LIMIT 1`)
      .get() as { uuid: string };
    h.sqlite
      .prepare(
        `INSERT INTO xact (uuid, acctype, account, security, date, type, shares, amount, currency, updatedAt, _xmlid, _order)
         VALUES (?, 'portfolio', ?, ?, '2026-07-15', 'BUY', ?, 100000, 'EUR', '2026-01-01T00:00:00', 0, 0)`,
      )
      .run(`tx-${Math.random().toString(36).slice(2)}`, acc.uuid, secId, Math.round(shareCount * 1e8));
    h.sqlite
      .prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, '2026-07-15', ?)`)
      .run(secId, Math.round(close * 1e8));
  } finally {
    releasePortfolioDb(pid);
  }
}

describe('stock split routes', () => {
  it('previews a reverse split without writing', async () => {
    const { app, pid, secId } = await setup();
    seedTradeAndQuote(pid, secId, 250, 4);

    const body = { exDate: EX_DATE, newShares: 1, oldShares: 25 };
    const res = await request(app)
      .post(`/api/p/${pid}/securities/${secId}/split/preview`)
      .send(body);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.counts.transactions).toBe(1);
    expect(res.body.counts.quotes).toBe(1);
    expect(res.body.transactions[0].sharesNew).toBe(10 * 1e8);
    expect(res.body.quotes[0].valueNew).toBe(100 * 1e8);

    // Nothing persisted — a second preview sees the original values.
    const again = await request(app)
      .post(`/api/p/${pid}/securities/${secId}/split/preview`)
      .send(body);
    expect(again.body.transactions[0].sharesOld).toBe(250 * 1e8);
  });

  it('applies the split and reports the counts', async () => {
    const { app, pid, secId } = await setup();
    seedTradeAndQuote(pid, secId, 250, 4);

    const res = await request(app)
      .post(`/api/p/${pid}/securities/${secId}/split`)
      .send({ exDate: EX_DATE, newShares: 1, oldShares: 25 });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.applied).toEqual({ transactions: 1, quotes: 1 });
    expect(typeof res.body.eventId).toBe('number');

    const events = await request(app).get(`/api/p/${pid}/securities/${secId}/events`);
    expect(events.status).toBe(200);
    expect(events.body[0].details).toBe('1:25');
    expect(events.body[0].type).toBe('STOCK_SPLIT');
  });

  it('returns 409 DUPLICATE_SPLIT on an identical repeat', async () => {
    const { app, pid, secId } = await setup();
    seedTradeAndQuote(pid, secId, 250, 4);
    const body = { exDate: EX_DATE, newShares: 1, oldShares: 25 };

    const first = await request(app).post(`/api/p/${pid}/securities/${secId}/split`).send(body);
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/p/${pid}/securities/${secId}/split`).send(body);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('DUPLICATE_SPLIT');
  });

  it('returns 400 INVALID_INPUT for a 1:1 ratio', async () => {
    const { app, pid, secId } = await setup();

    const res = await request(app)
      .post(`/api/p/${pid}/securities/${secId}/split`)
      .send({ exDate: EX_DATE, newShares: 1, oldShares: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 INVALID_INPUT for a malformed exDate', async () => {
    const { app, pid, secId } = await setup();

    const res = await request(app)
      .post(`/api/p/${pid}/securities/${secId}/split`)
      .send({ exDate: '16/07/2026', newShares: 1, oldShares: 25 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 INVALID_INPUT for a non-positive ratio side', async () => {
    const { app, pid, secId } = await setup();

    const res = await request(app)
      .post(`/api/p/${pid}/securities/${secId}/split`)
      .send({ exDate: EX_DATE, newShares: 0, oldShares: 25 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('returns 404 SECURITY_NOT_FOUND for an unknown security', async () => {
    const { app, pid } = await setup();

    const res = await request(app)
      .post(`/api/p/${pid}/securities/${UNKNOWN_SECURITY}/split`)
      .send({ exDate: EX_DATE, newShares: 1, oldShares: 25 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SECURITY_NOT_FOUND');
  });

  it('honours both opt-out flags — writes only the marker', async () => {
    const { app, pid, secId } = await setup();
    seedTradeAndQuote(pid, secId, 250, 4);

    const res = await request(app).post(`/api/p/${pid}/securities/${secId}/split`).send({
      exDate: EX_DATE,
      newShares: 1,
      oldShares: 25,
      changeTransactions: false,
      changeHistoricalQuotes: false,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.applied).toEqual({ transactions: 0, quotes: 0 });

    const events = await request(app).get(`/api/p/${pid}/securities/${secId}/events`);
    expect(events.body).toHaveLength(1);
  });
});
