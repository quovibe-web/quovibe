// Regression harness for BUG-26: GET /api/p/:pid/securities must filter out
// retired securities by default, and include them when ?includeRetired=true.
// Any regression that drops the WHERE clause or reverses the filter direction
// will fail these tests. Pairs with the "Show retired" checkbox on the
// Investments page.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-sec-retired-'));
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
  const rP = await request(app).post('/api/portfolios').send({ source: 'fresh', name });
  expect(rP.status).toBe(201);
  return rP.body.entry.id as string;
}

async function createSec(
  app: ReturnType<typeof createApp>,
  pid: string,
  name: string,
  isRetired: boolean,
): Promise<void> {
  const res = await request(app)
    .post(`/api/p/${pid}/securities`)
    .send({ name, currency: 'EUR', isRetired });
  expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(201);
}

describe('GET /api/p/:pid/securities includeRetired filter (BUG-26)', () => {
  it('omits retired securities by default', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'SEC-RETIRED-1');

    await createSec(app, pid, 'Active Security', false);
    await createSec(app, pid, 'Retired Security', true);

    const res = await request(app).get(`/api/p/${pid}/securities`);
    expect(res.status).toBe(200);
    const names = (res.body.data as { name: string; isRetired: boolean }[]).map(s => s.name);
    expect(names).toContain('Active Security');
    expect(names).not.toContain('Retired Security');
  });

  it('includes retired securities when ?includeRetired=true', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'SEC-RETIRED-2');

    await createSec(app, pid, 'Active Security', false);
    await createSec(app, pid, 'Retired Security', true);

    const res = await request(app).get(`/api/p/${pid}/securities?includeRetired=true`);
    expect(res.status).toBe(200);
    const rows = res.body.data as { name: string; isRetired: boolean }[];
    const names = rows.map(s => s.name);
    expect(names).toContain('Active Security');
    expect(names).toContain('Retired Security');
    const retiredRow = rows.find(s => s.name === 'Retired Security');
    expect(retiredRow?.isRetired).toBe(true);
  });

  it('strict row-count delta: includeRetired returns more rows than default', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'SEC-RETIRED-3');

    await createSec(app, pid, 'Active A', false);
    await createSec(app, pid, 'Active B', false);
    await createSec(app, pid, 'Retired A', true);
    await createSec(app, pid, 'Retired B', true);

    const rDefault = await request(app).get(`/api/p/${pid}/securities`);
    const rAll = await request(app).get(`/api/p/${pid}/securities?includeRetired=true`);

    expect(rDefault.status).toBe(200);
    expect(rAll.status).toBe(200);
    expect(rDefault.body.data).toHaveLength(2);
    expect(rAll.body.data).toHaveLength(4);
  });

  it('ignores unrecognized values of includeRetired (defaults to false)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'SEC-RETIRED-4');

    await createSec(app, pid, 'Active Security', false);
    await createSec(app, pid, 'Retired Security', true);

    // Only the literal string 'true' toggles the filter off — anything else
    // (e.g. '1', 'yes') must fall back to the default exclude-retired behavior.
    const res = await request(app).get(`/api/p/${pid}/securities?includeRetired=1`);
    expect(res.status).toBe(200);
    const names = (res.body.data as { name: string }[]).map(s => s.name);
    expect(names).toEqual(['Active Security']);
  });
});
