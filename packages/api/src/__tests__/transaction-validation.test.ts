// Regression harness for BUG-01 + BUG-04: the transaction write path accepted
// shape-invalid transfers that violate double-entry invariants.
//
//   BUG-01 — TRANSFER_BETWEEN_ACCOUNTS / SECURITY_TRANSFER with
//            `accountId === crossAccountId` was accepted (201). The natural-key
//            check is now in the shared Zod schema; the service never runs.
//
//   BUG-04 — TRANSFER_BETWEEN_ACCOUNTS with a portfolio account on either side
//            was accepted (201) because the route's 422 guard blanket-bypassed
//            portfolio accounts. The bypass is now narrowed to
//            `CASH_ONLY_ROUTED_TYPES` and the guard is applied symmetrically to
//            `crossAccountId` as well.
//
// The scaffold mirrors `transaction-idempotency.test.ts` (BUG-50) so that the
// whole boundary-validation family of bugs lives under one test style.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-tx-valid-'));
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

interface SeededAccounts {
  depositA: string;
  depositB: string;
  portfolioA: string;
  portfolioB: string;
}

function seedAccounts(pid: string): SeededAccounts {
  const ids: SeededAccounts = {
    depositA: randomUUID(),
    depositB: randomUUID(),
    portfolioA: randomUUID(),
    portfolioB: randomUUID(),
  };
  const h = acquirePortfolioDb(pid);
  try {
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order, referenceAccount)
       VALUES (?, ?, ?, 'EUR', ?, '2026-01-01T00:00:00Z', ?, ?, ?)`,
    ).run(101, ids.depositA, 'Cash A', 'account', 0, 0, null);
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order, referenceAccount)
       VALUES (?, ?, ?, 'EUR', ?, '2026-01-01T00:00:00Z', ?, ?, ?)`,
    ).run(102, ids.depositB, 'Cash B', 'account', 1, 1, null);
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order, referenceAccount)
       VALUES (?, ?, ?, 'EUR', ?, '2026-01-01T00:00:00Z', ?, ?, ?)`,
    ).run(103, ids.portfolioA, 'Titoli A', 'portfolio', 2, 2, ids.depositA);
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order, referenceAccount)
       VALUES (?, ?, ?, 'EUR', ?, '2026-01-01T00:00:00Z', ?, ?, ?)`,
    ).run(104, ids.portfolioB, 'Titoli B', 'portfolio', 3, 3, ids.depositB);
  } finally {
    releasePortfolioDb(pid);
  }
  return ids;
}

async function makePortfolio(): Promise<{ app: ReturnType<typeof createApp>; pid: string; accts: SeededAccounts }> {
  loadSettings();
  recoverFromInterruptedSwap();
  const app = createApp();
  const rP = await request(app).post('/api/portfolios').send({
    source: 'fresh', name: `VAL-${randomUUID().slice(0, 8)}`,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(rP.status).toBe(201);
  const pid = rP.body.entry.id;
  const accts = seedAccounts(pid);
  return { app, pid, accts };
}

describe('transaction write validation', () => {
  // ────────────────────────────────────────────────────────────────────────
  // BUG-01: same-account transfers
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-01: TRANSFER_BETWEEN_ACCOUNTS with accountId === crossAccountId returns 400', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: accts.depositA,
    });
    expect(r.status).toBe(400);

    const list = await request(app).get(`/api/p/${pid}/transactions?account=${accts.depositA}`);
    expect(list.body.total).toBe(0);
  });

  it('BUG-01: SECURITY_TRANSFER with accountId === crossAccountId returns 400', async () => {
    const { app, pid, accts } = await makePortfolio();
    // Seed a security so the shares-required check does not intercept first.
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (200, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'SECURITY_TRANSFER',
      amount: 0,
      shares: 10,
      securityId: secId,
      accountId: accts.portfolioA,
      crossAccountId: accts.portfolioA,
    });
    expect(r.status).toBe(400);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-04: portfolio account on either side of a TRANSFER_BETWEEN_ACCOUNTS
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-04: TRANSFER_BETWEEN_ACCOUNTS with portfolio source returns 422', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.portfolioA,
      crossAccountId: accts.depositB,
    });
    expect(r.status).toBe(422);

    const list = await request(app).get(`/api/p/${pid}/transactions?account=${accts.portfolioA}`);
    expect(list.body.total).toBe(0);
  });

  it('BUG-04: TRANSFER_BETWEEN_ACCOUNTS with portfolio destination returns 422', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: accts.portfolioB,
    });
    expect(r.status).toBe(422);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Regressions: the new guards must not break valid flows
  // ────────────────────────────────────────────────────────────────────────
  it('valid TRANSFER_BETWEEN_ACCOUNTS deposit→deposit still succeeds', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: accts.depositB,
    });
    expect(r.status).toBe(201);
  });

  it('valid SECURITY_TRANSFER portfolio→portfolio still succeeds', async () => {
    const { app, pid, accts } = await makePortfolio();
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (201, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'SECURITY_TRANSFER',
      amount: 100,
      shares: 10,
      securityId: secId,
      accountId: accts.portfolioA,
      crossAccountId: accts.portfolioB,
    });
    expect(r.status).toBe(201);
  });

  it('PUT update that introduces a portfolio destination is also rejected (422)', async () => {
    const { app, pid, accts } = await makePortfolio();
    // Start from a valid deposit→deposit transfer.
    const created = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: accts.depositB,
    });
    expect(created.status).toBe(201);
    const txId = created.body.uuid;

    // Try to flip the destination to a portfolio via PUT — the update handler's
    // enforceAccountTypeGuards must reject it the same way POST did.
    const r = await request(app).put(`/api/p/${pid}/transactions/${txId}`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: accts.portfolioB,
    });
    expect(r.status).toBe(422);
  });

  it('DEPOSIT on a portfolio still routes to its linked cash account (bypass preserved for cash-only types)', async () => {
    const { app, pid, accts } = await makePortfolio();
    // portfolioA.referenceAccount is depositA. Posting a DEPOSIT to the portfolio
    // should succeed (CASH_ONLY_ROUTED → bypass still applies) and land on depositA.
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'DEPOSIT',
      amount: 50,
      currencyCode: 'EUR',
      accountId: accts.portfolioA,
    });
    expect(r.status, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`).toBe(201);

    const list = await request(app).get(`/api/p/${pid}/transactions?account=${accts.depositA}`);
    expect(list.body.total).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-106: securityId required for security-bearing types
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-106: BUY without securityId returns 400', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      currencyCode: 'EUR',
      accountId: accts.portfolioA,
    });
    expect(r.status).toBe(400);
  });

  it('BUG-106: DIVIDEND without securityId returns 400', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'DIVIDEND',
      amount: 5,
      currencyCode: 'EUR',
      accountId: accts.depositA,
    });
    expect(r.status).toBe(400);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-107: BUY/SELL routed to deposit accountId
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-107: BUY with a deposit accountId returns 422 TRANSACTION_TYPE_NOT_ALLOWED_FOR_SOURCE', async () => {
    const { app, pid, accts } = await makePortfolio();
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (300, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    // The bug is that BUY accepts a deposit `accountId`. Don't pass crossAccountId
    // here — that would test a transfer-shaped payload, not the BUY/SELL source rule.
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      securityId: secId,
      currencyCode: 'EUR',
      accountId: accts.depositA,
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('TRANSACTION_TYPE_NOT_ALLOWED_FOR_SOURCE');
  });

  it('BUG-107: SELL with a deposit accountId returns 422', async () => {
    const { app, pid, accts } = await makePortfolio();
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (301, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'SELL',
      amount: 100,
      shares: 1,
      securityId: secId,
      currencyCode: 'EUR',
      accountId: accts.depositA,
    });
    expect(r.status).toBe(422);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-111: cross-currency TRANSFER_BETWEEN_ACCOUNTS without fxRate
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-111: TRANSFER_BETWEEN_ACCOUNTS cross-currency without fxRate returns 400 FX_RATE_REQUIRED', async () => {
    const { app, pid, accts } = await makePortfolio();
    // Add a USD deposit alongside the EUR deposits.
    const usdId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order, referenceAccount)
         VALUES (?, ?, 'USD Cash', 'USD', 'account', '2026-01-01T00:00:00Z', ?, ?, ?)`,
      ).run(105, usdId, 4, 4, null);
    } finally {
      releasePortfolioDb(pid);
    }

    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: usdId,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('FX_RATE_REQUIRED');

    // Same payload + fxRate succeeds.
    const ok = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: usdId,
      fxRate: 1.10,
    });
    expect(ok.status).toBe(201);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-112: cross-currency BUY without fxRate
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-112: BUY cross-currency without fxRate returns 400 FX_RATE_REQUIRED', async () => {
    const { app, pid, accts } = await makePortfolio();
    const usdSecId = randomUUID();
    const usdCashId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (310, ?, 'USD-SEC', 'USD', '2026-01-01T00:00:00Z')`,
      ).run(usdSecId);
      h.sqlite.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order, referenceAccount)
         VALUES (?, ?, 'USD Cash 2', 'USD', 'account', '2026-01-01T00:00:00Z', ?, ?, ?)`,
      ).run(106, usdCashId, 5, 5, null);
    } finally {
      releasePortfolioDb(pid);
    }

    // EUR portfolio (referenceAccount = EUR depositA) buying a USD security.
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      securityId: usdSecId,
      currencyCode: 'USD',
      accountId: accts.portfolioA,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('FX_RATE_REQUIRED');

    // With fxRate set on the wire, the route gate clears AND the service's
    // FX-fetch branch (transaction.service.ts ~L399) is skipped — so this
    // 201 doesn't depend on a populated vf_exchange_rate cache.
    const ok = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      securityId: usdSecId,
      currencyCode: 'USD',
      accountId: accts.portfolioA,
      fxRate: 1.10,
    });
    expect(ok.status).toBe(201);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-113: amount=0 allowed for share-only types
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-113: SECURITY_TRANSFER with amount=0 succeeds', async () => {
    const { app, pid, accts } = await makePortfolio();
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (320, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'SECURITY_TRANSFER',
      amount: 0,
      shares: 10,
      securityId: secId,
      accountId: accts.portfolioA,
      crossAccountId: accts.portfolioB,
    });
    expect(r.status, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`).toBe(201);
  });

  it('BUG-113: DELIVERY_INBOUND with amount=0 succeeds', async () => {
    const { app, pid, accts } = await makePortfolio();
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (321, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'DELIVERY_INBOUND',
      amount: 0,
      shares: 10,
      securityId: secId,
      accountId: accts.portfolioA,
    });
    expect(r.status, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`).toBe(201);
  });

  it('BUG-113: DELIVERY_OUTBOUND with amount=0 succeeds', async () => {
    const { app, pid, accts } = await makePortfolio();
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (322, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'DELIVERY_OUTBOUND',
      amount: 0,
      shares: 10,
      securityId: secId,
      accountId: accts.portfolioA,
    });
    expect(r.status, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`).toBe(201);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-108: unknown FK refs surface as structured 400, not raw 500 + leak
  // ────────────────────────────────────────────────────────────────────────
  const BOGUS_UUID = '00000000-0000-0000-0000-000000000000';

  function assertNoFkLeak(body: unknown): void {
    expect(JSON.stringify(body)).not.toMatch(/FOREIGN KEY/i);
  }

  it('BUG-108: POST DEPOSIT with bogus accountId returns 400 ACCOUNT_NOT_FOUND', async () => {
    const { app, pid } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'DEPOSIT',
      amount: 50,
      currencyCode: 'EUR',
      accountId: BOGUS_UUID,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('ACCOUNT_NOT_FOUND');
    assertNoFkLeak(r.body);
  });

  it('BUG-108: POST TRANSFER_BETWEEN_ACCOUNTS with bogus crossAccountId returns 400 ACCOUNT_NOT_FOUND', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      amount: 100,
      currencyCode: 'EUR',
      accountId: accts.depositA,
      crossAccountId: BOGUS_UUID,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('ACCOUNT_NOT_FOUND');
    assertNoFkLeak(r.body);
  });

  it('BUG-108: POST BUY with bogus securityId returns 400 SECURITY_NOT_FOUND', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      currencyCode: 'EUR',
      accountId: accts.portfolioA,
      securityId: BOGUS_UUID,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('SECURITY_NOT_FOUND');
    assertNoFkLeak(r.body);
  });

  it('BUG-108: PUT with bogus accountId returns 400 ACCOUNT_NOT_FOUND', async () => {
    const { app, pid, accts } = await makePortfolio();
    const created = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'DEPOSIT',
      amount: 50,
      currencyCode: 'EUR',
      accountId: accts.depositA,
    });
    expect(created.status).toBe(201);
    const txId = created.body.uuid;

    const r = await request(app).put(`/api/p/${pid}/transactions/${txId}`).send({
      date: '2026-01-01',
      type: 'DEPOSIT',
      amount: 50,
      currencyCode: 'EUR',
      accountId: BOGUS_UUID,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('ACCOUNT_NOT_FOUND');
    assertNoFkLeak(r.body);
  });

  it('BUG-108: PUT with bogus securityId returns 400 SECURITY_NOT_FOUND', async () => {
    const { app, pid, accts } = await makePortfolio();
    const secId = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, updatedAt)
         VALUES (330, ?, 'ACME', 'EUR', '2026-01-01T00:00:00Z')`,
      ).run(secId);
    } finally {
      releasePortfolioDb(pid);
    }
    const created = await request(app).post(`/api/p/${pid}/transactions`).send({
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      currencyCode: 'EUR',
      accountId: accts.portfolioA,
      securityId: secId,
    });
    expect(created.status).toBe(201);
    const txId = created.body.uuid;

    const r = await request(app).put(`/api/p/${pid}/transactions/${txId}`).send({
      date: '2026-01-01',
      type: 'BUY',
      amount: 100,
      shares: 1,
      currencyCode: 'EUR',
      accountId: accts.portfolioA,
      securityId: BOGUS_UUID,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('SECURITY_NOT_FOUND');
    assertNoFkLeak(r.body);
  });

  // ────────────────────────────────────────────────────────────────────────
  // BUG-109: URL-target not found is structured 404 TRANSACTION_NOT_FOUND
  // ────────────────────────────────────────────────────────────────────────
  it('BUG-109: GET unknown :id returns 404 TRANSACTION_NOT_FOUND', async () => {
    const { app, pid } = await makePortfolio();
    const r = await request(app).get(`/api/p/${pid}/transactions/${BOGUS_UUID}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('TRANSACTION_NOT_FOUND');
  });

  it('BUG-109: PUT unknown :id returns 404 TRANSACTION_NOT_FOUND', async () => {
    const { app, pid, accts } = await makePortfolio();
    const r = await request(app).put(`/api/p/${pid}/transactions/${BOGUS_UUID}`).send({
      date: '2026-01-01',
      type: 'DEPOSIT',
      amount: 50,
      currencyCode: 'EUR',
      accountId: accts.depositA,
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('TRANSACTION_NOT_FOUND');
  });

  it('BUG-109: DELETE unknown :id returns 404 TRANSACTION_NOT_FOUND', async () => {
    const { app, pid } = await makePortfolio();
    const r = await request(app).delete(`/api/p/${pid}/transactions/${BOGUS_UUID}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('TRANSACTION_NOT_FOUND');
  });
});
