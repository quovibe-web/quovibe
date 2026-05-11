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

  it('keeps retired securities in default list when shares > 0 (BUG-PRE14-09)', async () => {
    // PP parity: retired flag hides only fully-closed positions. A security
    // marked retired that still has held shares must remain visible — otherwise
    // the Investments page footer aggregates a different security set than the
    // statement-of-assets / treemap, producing a count + total mismatch.
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'SEC-RETIRED-HELD');

    await createSec(app, pid, 'Held Active', false);
    await createSec(app, pid, 'Held Retired', false);
    await createSec(app, pid, 'Closed Retired', true);

    const list = await request(app).get(`/api/p/${pid}/securities`);
    expect(list.status).toBe(200);
    const heldRetired = (list.body.data as { id: string; name: string }[])
      .find(s => s.name === 'Held Retired');
    expect(heldRetired).toBeDefined();
    const heldActive = (list.body.data as { id: string; name: string }[])
      .find(s => s.name === 'Held Active');
    expect(heldActive).toBeDefined();

    const accountsRes = await request(app).get(`/api/p/${pid}/accounts`);
    const allAccounts = accountsRes.body as { id: string; type: string }[];
    const portfolioAccountId = allAccounts.find(a => a.type === 'portfolio')!.id;
    const cashAccountId = allAccounts.find(a => a.type === 'account')!.id;

    for (const secId of [heldActive!.id, heldRetired!.id]) {
      const buy = await request(app).post(`/api/p/${pid}/transactions`).send({
        type: 'BUY',
        date: '2025-01-15',
        accountId: portfolioAccountId,
        crossAccountId: cashAccountId,
        securityId: secId,
        shares: 10,
        amount: 100,
        currency: 'EUR',
        fees: 0,
        taxes: 0,
      });
      expect(buy.status, JSON.stringify(buy.body)).toBe(201);
    }

    const retire = await request(app).put(`/api/p/${pid}/securities/${heldRetired!.id}`)
      .send({ isRetired: true });
    expect(retire.status, JSON.stringify(retire.body)).toBe(200);

    const after = await request(app).get(`/api/p/${pid}/securities`);
    expect(after.status).toBe(200);
    const names = (after.body.data as { name: string; isRetired: boolean; shares: string }[])
      .map(s => s.name);
    expect(names).toContain('Held Active');
    expect(names).toContain('Held Retired');
    expect(names).not.toContain('Closed Retired');
  });

  it('?asOf=YYYY-MM-DD evaluates net shares at that date (BUG-PRE14-09)', async () => {
    // PP parity: a security held at the period boundary but exited since
    // "now" must remain visible when the user views that period. Without
    // asOf the lifetime netSharesMap returns 0 and the row vanishes from
    // the table while still appearing in the period-scoped statement-of-
    // assets and treemap (mismatched count + market-value footer).
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'SEC-RETIRED-ASOF');

    await createSec(app, pid, 'Held Then Sold', false);

    const accountsRes = await request(app).get(`/api/p/${pid}/accounts`);
    const allAccounts = accountsRes.body as { id: string; type: string }[];
    const portfolioAccountId = allAccounts.find(a => a.type === 'portfolio')!.id;
    const cashAccountId = allAccounts.find(a => a.type === 'account')!.id;

    const list = await request(app).get(`/api/p/${pid}/securities`);
    const heldThenSold = (list.body.data as { id: string; name: string }[])
      .find(s => s.name === 'Held Then Sold')!;

    const buy = await request(app).post(`/api/p/${pid}/transactions`).send({
      type: 'BUY',
      date: '2025-01-15',
      accountId: portfolioAccountId,
      crossAccountId: cashAccountId,
      securityId: heldThenSold.id,
      shares: 10,
      amount: 100,
      currency: 'EUR',
      fees: 0,
      taxes: 0,
    });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);

    const sell = await request(app).post(`/api/p/${pid}/transactions`).send({
      type: 'SELL',
      date: '2026-03-10',
      accountId: portfolioAccountId,
      crossAccountId: cashAccountId,
      securityId: heldThenSold.id,
      shares: 10,
      amount: 100,
      currency: 'EUR',
      fees: 0,
      taxes: 0,
    });
    expect(sell.status, JSON.stringify(sell.body)).toBe(201);

    const retire = await request(app).put(`/api/p/${pid}/securities/${heldThenSold.id}`)
      .send({ isRetired: true });
    expect(retire.status, JSON.stringify(retire.body)).toBe(200);

    // Default (no asOf) — lifetime shares == 0 — retired-with-no-holdings is
    // hidden by the includeRetired=false filter.
    const lifetime = await request(app).get(`/api/p/${pid}/securities`);
    expect(lifetime.status).toBe(200);
    expect((lifetime.body.data as { name: string }[]).map(s => s.name))
      .not.toContain('Held Then Sold');

    // asOf=2025-12-31 — the security held 10 shares on that date — must
    // appear with shares='10' even though it is retired and lifetime-zero
    // now. This is the SoA-alignment fix.
    const periodEnd = await request(app)
      .get(`/api/p/${pid}/securities?asOf=2025-12-31`);
    expect(periodEnd.status).toBe(200);
    const row = (periodEnd.body.data as { name: string; shares: string; isRetired: boolean }[])
      .find(s => s.name === 'Held Then Sold');
    expect(row).toBeDefined();
    expect(row!.isRetired).toBe(true);
    expect(parseFloat(row!.shares)).toBe(10);

    // asOf=2024-12-31 — pre-buy date — the security never appears (zero
    // shares as of that date and retired).
    const preBuy = await request(app)
      .get(`/api/p/${pid}/securities?asOf=2024-12-31`);
    expect((preBuy.body.data as { name: string }[]).map(s => s.name))
      .not.toContain('Held Then Sold');
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
