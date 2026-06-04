// Regression harness: GET /api/p/:pid/securities?tradedOnly=true must hide
// watchlist-only (never-transacted) securities and show all securities with
// any transaction history (held, exited, dividends-only, etc.).
//
// Any regression that drops the tradedOnly gate, lets watchlist-only instruments
// leak through, or accidentally hides exited positions must make this suite fail.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-sec-traded-'));
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

async function freshPortfolio(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const rP = await request(app).post('/api/portfolios').send({
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(rP.status).toBe(201);
  return rP.body.entry.id as string;
}

async function createSec(
  app: ReturnType<typeof createApp>,
  pid: string,
  name: string,
): Promise<string> {
  const res = await request(app)
    .post(`/api/p/${pid}/securities`)
    .send({ name, currency: 'EUR', isRetired: false });
  expect(res.status, `createSec failed: ${res.status} ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.id as string;
}

describe('GET /api/p/:pid/securities?tradedOnly=true', () => {
  it('default (no tradedOnly param) returns watchlist-only and traded securities', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'TRADED-1');

    await createSec(app, pid, 'Traded Security');
    await createSec(app, pid, 'Watchlist Only Security');

    // No transactions — both are watchlist-only at this point. The default
    // endpoint must return both (unchanged baseline behavior).
    const res = await request(app).get(`/api/p/${pid}/securities`);
    expect(res.status).toBe(200);
    const names = (res.body.data as { name: string }[]).map(s => s.name);
    expect(names).toContain('Traded Security');
    expect(names).toContain('Watchlist Only Security');
  });

  it('tradedOnly=true hides never-transacted securities', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'TRADED-2');

    const tradedId = await createSec(app, pid, 'Traded Security');
    await createSec(app, pid, 'Watchlist Only Security');

    // Fetch accounts to get valid IDs for a BUY transaction
    const accsRes = await request(app).get(`/api/p/${pid}/accounts`);
    const accounts = accsRes.body as { id: string; type: string }[];
    const portfolioAccId = accounts.find(a => a.type === 'portfolio')!.id;
    const cashAccId = accounts.find(a => a.type === 'account')!.id;

    const buy = await request(app).post(`/api/p/${pid}/transactions`).send({
      type: 'BUY',
      date: '2025-01-15',
      accountId: portfolioAccId,
      crossAccountId: cashAccId,
      securityId: tradedId,
      shares: 10,
      amount: 100,
      currency: 'EUR',
      fees: 0,
      taxes: 0,
    });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);

    const res = await request(app).get(`/api/p/${pid}/securities?tradedOnly=true`);
    expect(res.status).toBe(200);
    const names = (res.body.data as { name: string }[]).map(s => s.name);
    expect(names).toContain('Traded Security');
    expect(names).not.toContain('Watchlist Only Security');
  });

  it('tradedOnly=true keeps fully-sold (exited) positions visible', async () => {
    // User confirmed: exited positions must remain visible.
    // A security with BUY + SELL and 0 net shares still has transaction
    // history → must appear under tradedOnly=true.
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'TRADED-3');

    const exitedId = await createSec(app, pid, 'Exited Security');
    await createSec(app, pid, 'Watchlist Only Security');

    const accsRes = await request(app).get(`/api/p/${pid}/accounts`);
    const accounts = accsRes.body as { id: string; type: string }[];
    const portfolioAccId = accounts.find(a => a.type === 'portfolio')!.id;
    const cashAccId = accounts.find(a => a.type === 'account')!.id;

    const buy = await request(app).post(`/api/p/${pid}/transactions`).send({
      type: 'BUY',
      date: '2025-01-15',
      accountId: portfolioAccId,
      crossAccountId: cashAccId,
      securityId: exitedId,
      shares: 10,
      amount: 100,
      currency: 'EUR',
      fees: 0,
      taxes: 0,
    });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);

    const sell = await request(app).post(`/api/p/${pid}/transactions`).send({
      type: 'SELL',
      date: '2025-06-01',
      accountId: portfolioAccId,
      crossAccountId: cashAccId,
      securityId: exitedId,
      shares: 10,
      amount: 110,
      currency: 'EUR',
      fees: 0,
      taxes: 0,
    });
    expect(sell.status, JSON.stringify(sell.body)).toBe(201);

    const res = await request(app).get(`/api/p/${pid}/securities?tradedOnly=true`);
    expect(res.status).toBe(200);
    const rows = res.body.data as { name: string; shares: string }[];
    const exitedRow = rows.find(r => r.name === 'Exited Security');
    expect(exitedRow, 'exited security must still appear under tradedOnly=true').toBeDefined();
    expect(parseFloat(exitedRow!.shares)).toBe(0);

    const watchlistRow = rows.find(r => r.name === 'Watchlist Only Security');
    expect(watchlistRow, 'watchlist-only must be hidden under tradedOnly=true').toBeUndefined();
  });

  it('tradedOnly=1 (non-"true") falls back to full list (param-parse guard)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'TRADED-4');

    await createSec(app, pid, 'Watchlist Only Security');
    // No transactions — if tradedOnly=1 were honored, this security would vanish.

    const res = await request(app).get(`/api/p/${pid}/securities?tradedOnly=1`);
    expect(res.status).toBe(200);
    const names = (res.body.data as { name: string }[]).map(s => s.name);
    expect(names).toContain('Watchlist Only Security');
  });
});
