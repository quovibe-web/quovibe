// Regression harness for BUG-50: POST /api/p/:pid/transactions accepted N
// identical parallel submissions, producing N duplicate rows. The service-layer
// fix dedupes by natural key within a short window (see `DEDUPE_WINDOW_MS` in
// `transaction.service.ts`). Any regression that removes the guard will cause
// this test to fail.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-tx-idem-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;
let acquirePortfolioDb: typeof import('../services/portfolio-db-pool').acquirePortfolioDb;
let releasePortfolioDb: typeof import('../services/portfolio-db-pool').releasePortfolioDb;
let DEDUPE_WINDOW_MS: number;

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
  ({ DEDUPE_WINDOW_MS } = await import('../services/transaction.service'));
});

function seedCashAccount(id: string): string {
  const accountUuid = randomUUID();
  const h = acquirePortfolioDb(id);
  try {
    // Distinct name from the auto-seeded 'Cash' primary deposit so there is no
    // ambiguity in the test fixture; the route filters by accountId UUID
    // anyway, but the raw INSERT bypass means we want a unique label too.
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order)
       VALUES (100, ?, 'Test Cash', 'EUR', 'account', '2026-01-01T00:00:00Z', 100, 100)`,
    ).run(accountUuid);
  } finally {
    releasePortfolioDb(id);
  }
  return accountUuid;
}

function seedSecuritiesAccount(id: string, label: string): string {
  const accountUuid = randomUUID();
  const h = acquirePortfolioDb(id);
  try {
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order)
       VALUES (200, ?, ?, NULL, 'portfolio', '2026-01-01T00:00:00Z', 200, 200)`,
    ).run(accountUuid, label);
  } finally {
    releasePortfolioDb(id);
  }
  return accountUuid;
}

function seedSecurity(id: string): string {
  const securityUuid = randomUUID();
  const h = acquirePortfolioDb(id);
  try {
    h.sqlite.prepare(
      `INSERT INTO security (_id, uuid, name, currency, isRetired, updatedAt)
       VALUES (300, ?, 'Test Sec', 'EUR', 0, '2026-01-01T00:00:00Z')`,
    ).run(securityUuid);
  } finally {
    releasePortfolioDb(id);
  }
  return securityUuid;
}

describe('POST /transactions idempotency (BUG-50)', () => {
  it('5 identical parallel POSTs produce exactly 1 row', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({
      source: 'fresh', name: 'IDEM',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id;
    const accountUuid = seedCashAccount(pid);

    const body = {
      date: '2026-01-01',
      type: 'DEPOSIT',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accountUuid,
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/api/p/${pid}/transactions`).send(body),
      ),
    );

    // All 5 requests are accepted (idempotent replays return the cached 201).
    for (const r of results) {
      expect(r.status, `unexpected status: ${r.status} ${JSON.stringify(r.body)}`).toBe(201);
    }
    // All 5 point to the same row (same uuid).
    const uuids = new Set(results.map(r => r.body.uuid));
    expect(uuids.size, `expected 1 unique uuid across 5 responses, got ${uuids.size}`).toBe(1);

    // The list endpoint confirms exactly one row landed.
    const list = await request(app).get(`/api/p/${pid}/transactions?account=${accountUuid}`);
    expect(list.status).toBe(200);
    expect(list.body.total, `expected total=1, got total=${list.body.total}`).toBe(1);
  });

  it('two identical POSTs spaced past the dedupe window create 2 rows', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({
      source: 'fresh', name: 'IDEM2',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id;
    const accountUuid = seedCashAccount(pid);

    const body = {
      date: '2026-01-01',
      type: 'DEPOSIT',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accountUuid,
    };

    // Legitimate duplicate: same user enters the same deposit a few seconds
    // apart — both must persist. The dedupe window only swallows
    // within-millisecond races (double-click, multi-tab submit).
    const first = await request(app).post(`/api/p/${pid}/transactions`).send(body);
    expect(first.status).toBe(201);
    await new Promise(r => setTimeout(r, DEDUPE_WINDOW_MS + 500));
    const second = await request(app).post(`/api/p/${pid}/transactions`).send(body);
    expect(second.status).toBe(201);

    expect(second.body.uuid).not.toBe(first.body.uuid);

    const list = await request(app).get(`/api/p/${pid}/transactions?account=${accountUuid}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
  });
});

// Regression for BUG-123: the natural-key dedupe must NOT collapse distinct
// wire-form types whose ppxml2db DB-form encoding is shared. SECURITY_TRANSFER,
// DELIVERY_OUTBOUND, and the source leg of TRANSFER_BETWEEN_ACCOUNTS all map
// to `xact.type = 'TRANSFER_OUT'`; before the fix, the dedupe key keyed only
// on DB-form `type`, so back-to-back distinct-type POSTs against the same
// security/account within DEDUPE_WINDOW_MS silently swallowed the second
// insert.
describe('POST /transactions wire-form-type discriminator (BUG-123)', () => {
  it('SECURITY_TRANSFER followed by DELIVERY_OUTBOUND within the dedupe window produces distinct rows', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({
      source: 'fresh', name: 'IDEM3',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id;

    const portB = seedSecuritiesAccount(pid, 'Other Securities');
    const securityId = seedSecurity(pid);

    // Resolve the auto-seeded primary securities account.
    const accs = await request(app).get(`/api/p/${pid}/securities-accounts`);
    expect(accs.status).toBe(200);
    const portA: string = accs.body[0].id;

    const securityTransfer = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'SECURITY_TRANSFER',
      amount: 0,
      shares: 1,
      securityId,
      accountId: portA,
      crossAccountId: portB,
    });
    expect(securityTransfer.status, JSON.stringify(securityTransfer.body)).toBe(201);

    // Same security/account/shares/amount, no dedupe-window wait.
    const deliveryOutbound = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'DELIVERY_OUTBOUND',
      amount: 0,
      shares: 1,
      securityId,
      accountId: portA,
    });
    expect(deliveryOutbound.status, JSON.stringify(deliveryOutbound.body)).toBe(201);

    expect(
      deliveryOutbound.body.uuid,
      'BUG-123 regression: DELIVERY_OUTBOUND must not collapse onto preceding SECURITY_TRANSFER',
    ).not.toBe(securityTransfer.body.uuid);

    const list = await request(app).get(`/api/p/${pid}/transactions?account=${portA}`);
    expect(list.status).toBe(200);
    expect(list.body.total, `expected total=2 on portA, got ${list.body.total}`).toBe(2);
  });

  it('5 identical parallel BUY POSTs without explicit crossAccountId still produce exactly 1 row (BUG-50 BUY/SELL leg)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({
      source: 'fresh', name: 'IDEM5',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id;

    const securityId = seedSecurity(pid);
    const accs = await request(app).get(`/api/p/${pid}/securities-accounts`);
    expect(accs.status).toBe(200);
    const portA: string = accs.body[0].id;

    // BUY without an explicit `crossAccountId` — the service auto-routes the
    // cash leg to the portfolio's referenceAccount. The dedupe key MUST
    // resolve `ce.to_acc` to that same referenceAccount, otherwise a
    // 5-parallel POST regresses to 5 rows.
    const body = {
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      currencyCode: 'EUR',
      securityId,
      accountId: portA,
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/api/p/${pid}/transactions`).send(body),
      ),
    );
    for (const r of results) {
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const uuids = new Set(results.map(r => r.body.uuid));
    expect(uuids.size, `expected 1 unique uuid across 5 BUY responses, got ${uuids.size}`).toBe(1);
  });

  it('two identical SECURITY_TRANSFER POSTs within the dedupe window still collapse (BUG-50 not regressed)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({
      source: 'fresh', name: 'IDEM4',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id;

    const portB = seedSecuritiesAccount(pid, 'Other Securities');
    const securityId = seedSecurity(pid);

    const accs = await request(app).get(`/api/p/${pid}/securities-accounts`);
    expect(accs.status).toBe(200);
    const portA: string = accs.body[0].id;

    const body = {
      date: '2026-01-01',
      type: 'SECURITY_TRANSFER',
      amount: 0,
      shares: 1,
      securityId,
      accountId: portA,
      crossAccountId: portB,
    };

    const a = await request(app).post(`/api/p/${pid}/transactions`).send(body);
    const b = await request(app).post(`/api/p/${pid}/transactions`).send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.uuid, 'identical SECURITY_TRANSFERs must still dedupe').toBe(a.body.uuid);
  });
});
