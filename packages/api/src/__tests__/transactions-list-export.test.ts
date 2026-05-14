// Regression harness for BUG-60: GET /api/p/:pid/transactions paginates with a
// hard cap at limit=100, which made the client-side CSV export emit only the
// current page. The server now honours `?limit=all` to bypass paging (capped
// at EXPORT_HARD_CEILING=100000 server-side) so the export covers the full
// filtered dataset.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-tx-export-'));
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

async function makePortfolio(): Promise<{ app: ReturnType<typeof createApp>; pid: string; depositId: string }> {
  loadSettings();
  recoverFromInterruptedSwap();
  const app = createApp();
  const r = await request(app).post('/api/portfolios').send({
    source: 'fresh',
    name: `EXPORT-${randomUUID().slice(0, 8)}`,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(r.status).toBe(201);
  const pid = r.body.entry.id;
  // Find the auto-seeded primary deposit
  const accts = await request(app).get(`/api/p/${pid}/accounts`);
  const deposit = accts.body.find((a: { type: string; name: string }) =>
    a.type === 'account' && a.name === 'Cash');
  expect(deposit, `expected primary deposit, got: ${JSON.stringify(accts.body)}`).toBeDefined();
  return { app, pid, depositId: deposit.id };
}

async function seedDeposits(app: ReturnType<typeof createApp>, pid: string, depositId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      type: 'DEPOSIT',
      amount: 10 + i,
      currencyCode: 'EUR',
      accountId: depositId,
      note: `seed-${i}`,
    });
    expect(r.status, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`).toBe(201);
  }
}

describe('GET /transactions ?limit=all (BUG-60)', () => {
  it('default paging caps at limit=25 (current page only)', async () => {
    const { app, pid, depositId } = await makePortfolio();
    await seedDeposits(app, pid, depositId, 30);

    const r = await request(app).get(`/api/p/${pid}/transactions?limit=25&page=1`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(30);
    expect(r.body.data).toHaveLength(25);
  });

  it('limit=all returns the full filtered dataset in one response', async () => {
    const { app, pid, depositId } = await makePortfolio();
    await seedDeposits(app, pid, depositId, 30);

    const r = await request(app).get(`/api/p/${pid}/transactions?limit=all`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(30);
    expect(r.body.data).toHaveLength(30);
  });

  it('limit=all still honours filters (search / type / date range)', async () => {
    const { app, pid, depositId } = await makePortfolio();
    await seedDeposits(app, pid, depositId, 5);

    // Each row carries a distinct `note` (seed-0..seed-4); search for one.
    const r = await request(app).get(`/api/p/${pid}/transactions?limit=all&search=seed-3`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].note).toBe('seed-3');
  });

  it('rejects oversized numeric limit (clamps to 100, not unbounded)', async () => {
    const { app, pid, depositId } = await makePortfolio();
    await seedDeposits(app, pid, depositId, 30);

    // limit=999 must clamp to 100, NOT silently behave like `all`.
    const r = await request(app).get(`/api/p/${pid}/transactions?limit=999`);
    expect(r.status).toBe(200);
    expect(r.body.limit).toBe(100);
    expect(r.body.data.length).toBeLessThanOrEqual(100);
  });
});
