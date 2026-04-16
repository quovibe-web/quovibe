// Regression harness for the RC-1 cross-portfolio data leak.
//
// The fix deletes packages/api/src/services/statement-cache.ts whose
// module-scope statementCache / refCache were keyed only by date (or not at
// all) and returned one portfolio's data to a subsequent request on another
// portfolio within the TTL window.
//
// This test stays in place after the fix to catch any future regression that
// reintroduces cross-portfolio leakage on these endpoints — regardless of the
// underlying mechanism.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xp-isol-'));
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

function seedPortfolio(id: string, accountLabel: string): { accountUuid: string; portfolioAcctUuid: string; securityUuid: string } {
  const accountUuid = randomUUID();
  const portfolioAcctUuid = randomUUID();
  const securityUuid = randomUUID();
  const h = acquirePortfolioDb(id);
  try {
    // Cash (deposit) account — shows in statement.depositAccounts.
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order)
       VALUES (100, ?, ?, 'EUR', 'account', '2026-01-01T00:00:00Z', 0, 0)`,
    ).run(accountUuid, accountLabel);

    // Portfolio (securities) account — needed for DELIVERY_INBOUND rows.
    h.sqlite.prepare(
      `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order)
       VALUES (101, ?, ?, NULL, 'portfolio', '2026-01-01T00:00:00Z', 0, 0)`,
    ).run(portfolioAcctUuid, `${accountLabel}-portfolio`);

    // DEPOSIT transaction so balance != 0 (accounts with zero balance are
    // excluded from depositAccounts by getStatementOfAssets).
    h.sqlite.prepare(
      `INSERT INTO xact
         (_id, uuid, acctype, account, date, currency, amount, security, shares, note, source,
          updatedAt, type, fees, taxes, _xmlid, _order)
       VALUES (100, ?, 'account', ?, '2026-01-01', 'EUR', 100000, NULL, 0, NULL, NULL,
               '2026-01-01T00:00:00Z', 'DEPOSIT', 0, 0, 0, 0)`,
    ).run(randomUUID(), accountUuid);

    // Security row with a distinguishing name per portfolio.
    h.sqlite.prepare(
      `INSERT INTO security (_id, uuid, name, currency, isRetired, updatedAt)
       VALUES (100, ?, ?, 'EUR', 0, '2026-01-01T00:00:00Z')`,
    ).run(securityUuid, `${accountLabel}-sec`);

    // DELIVERY_INBOUND puts shares into the portfolio without needing a cash
    // counter-entry (Group C in .claude/rules/double-entry.md). Now the
    // security shows up in statement.securities with non-zero shares, which
    // means /reports/holdings returns populated `items` — essential for
    // the holdings leak assertion below.
    h.sqlite.prepare(
      `INSERT INTO xact
         (_id, uuid, acctype, account, date, currency, amount, security, shares, note, source,
          updatedAt, type, fees, taxes, _xmlid, _order)
       VALUES (101, ?, 'portfolio', ?, '2026-01-01', 'EUR', 0, ?, 100000000000, NULL, NULL,
               '2026-01-01T00:00:00Z', 'DELIVERY_INBOUND', 0, 0, 0, 0)`,
    ).run(randomUUID(), portfolioAcctUuid, securityUuid);

    // Seed a tiny price so market value is non-zero.
    h.sqlite.prepare(
      `INSERT INTO price (security, tstamp, value) VALUES (?, '2026-01-01', 100000000)`,
    ).run(securityUuid);
  } finally {
    releasePortfolioDb(id);
  }
  return { accountUuid, portfolioAcctUuid, securityUuid };
}

describe('cross-portfolio isolation (RC-1 regression)', () => {
  it('statement-of-assets on two portfolios returns per-portfolio data (not cached from the other)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rA = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'A' });
    const rB = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'B' });
    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);
    const idA = rA.body.entry.id;
    const idB = rB.body.entry.id;

    seedPortfolio(idA, 'A-cash');
    seedPortfolio(idB, 'B-cash');

    const date = '2026-04-16';

    // Hit A then B within the TTL window — under the bug, B's response was
    // a byte-identical copy of A's (statementCache keyed only by date).
    const stA = await request(app).get(`/api/p/${idA}/reports/statement-of-assets?date=${date}`);
    expect(stA.status).toBe(200);
    const stB = await request(app).get(`/api/p/${idB}/reports/statement-of-assets?date=${date}`);
    expect(stB.status).toBe(200);

    const aAccountNames = (stA.body.depositAccounts as { name: string }[] | undefined ?? []).map(a => a.name);
    const bAccountNames = (stB.body.depositAccounts as { name: string }[] | undefined ?? []).map(a => a.name);

    expect(aAccountNames, 'A should contain A-cash').toContain('A-cash');
    expect(bAccountNames, 'B should contain B-cash').toContain('B-cash');
    // The load-bearing leak assertions:
    expect(bAccountNames, 'B must not see A-cash (cross-portfolio leak)').not.toContain('A-cash');
    expect(aAccountNames, 'A must not see B-cash (cross-portfolio leak)').not.toContain('B-cash');

    // Cross-check: re-requesting A after B must still return A's data (proves
    // the cache is gone, not just per-last-caller).
    const stA2 = await request(app).get(`/api/p/${idA}/reports/statement-of-assets?date=${date}`);
    expect(stA2.status).toBe(200);
    const aAccountNames2 = (stA2.body.depositAccounts as { name: string }[] | undefined ?? []).map(a => a.name);
    expect(aAccountNames2).toContain('A-cash');
    expect(aAccountNames2).not.toContain('B-cash');
  });

  it('holdings on two portfolios return per-portfolio security names (same bug class via getCachedStatement/getCachedReferenceData)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rA = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'hA' });
    const rB = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'hB' });
    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);
    const idA = rA.body.entry.id;
    const idB = rB.body.entry.id;

    seedPortfolio(idA, 'h-A');
    seedPortfolio(idB, 'h-B');

    // Date AFTER the seeded DELIVERY_INBOUND (2026-01-01) so held shares show.
    const date = '2026-02-01';

    const hA = await request(app).get(`/api/p/${idA}/reports/holdings?date=${date}`);
    expect(hA.status).toBe(200);
    const hB = await request(app).get(`/api/p/${idB}/reports/holdings?date=${date}`);
    expect(hB.status).toBe(200);

    const aNames = ((hA.body.items ?? []) as { name: string }[]).map(i => i.name);
    const bNames = ((hB.body.items ?? []) as { name: string }[]).map(i => i.name);

    expect(aNames, 'A holdings should contain h-A-sec').toContain('h-A-sec');
    expect(bNames, 'B holdings should contain h-B-sec').toContain('h-B-sec');
    // Leak assertions: each response must not carry the other's security.
    expect(aNames, 'A holdings must not see h-B-sec (cross-portfolio leak)').not.toContain('h-B-sec');
    expect(bNames, 'B holdings must not see h-A-sec (cross-portfolio leak)').not.toContain('h-A-sec');
  });
});
