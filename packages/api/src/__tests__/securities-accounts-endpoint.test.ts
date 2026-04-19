// Integration test for GET /api/p/:pid/securities-accounts (BUG-54/55 Phase 2 — Task 2.2).
//
// Boundary-style supertest cases that drive the new route from the wire down
// to the SQL via the standard portfolio-context middleware. Reuses the shared
// fixtures in `_helpers/portfolio-fixtures.ts` so the seed shape stays in lock-
// step with the other Phase-1+ regression suites (e.g. csv-upload-hardening).
//
// IMPORTANT — env hand-off: the helper imports `createApp` dynamically, but
// `config.ts` reads QUOVIBE_DATA_DIR / QUOVIBE_DEMO_SOURCE at module-load
// time, so this file MUST set them at the top BEFORE importing the helper.
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-sec-accts-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import {
  seedFreshPortfolio,
  seedPortfolioWith2SecuritiesAccounts,
} from './_helpers/portfolio-fixtures';

beforeAll(async () => {
  // Seed the demo source DB so the registry's bootstrap pass is happy when the
  // app first boots. Mirrors csv-upload-hardening.test.ts.
  const { applyBootstrap } = await import('../db/apply-bootstrap');
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
});

describe('GET /api/p/:pid/securities-accounts', () => {
  // NOTE: `seedFreshPortfolio` calls `createPortfolio({source:'fresh', name})`
  // which today does NOT seed any account rows (that's BUG-54, fixed in
  // Task 2.4). So this case correctly expects an empty list with the current
  // server behavior and will need to be revisited when T2.4 lands.
  it('returns empty list for a fresh (N=0) portfolio', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app).get(`/api/p/${portfolioId}/securities-accounts`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns the N=2 rows for a Demo-like portfolio, ordered by _order', async () => {
    const { portfolioId, app } = await seedPortfolioWith2SecuritiesAccounts();
    const res = await request(app).get(`/api/p/${portfolioId}/securities-accounts`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(2);
    // Ordering contract — Phase 6's picker renders these in list order, so lock
    // the _order ASC invariant at the wire. Fixture inserts Broker A (_order=2)
    // before Broker B (_order=3).
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(['Broker A', 'Broker B']);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      currency: null,
      referenceAccountId: expect.any(String),
    });
  });

  it('404s for a non-existent portfolio', async () => {
    const { app } = await seedFreshPortfolio();
    // UUID is RFC-4122 v4-valid (passes UUID_V4_RE in portfolioContext) but not
    // registered — so the 404 comes from the registry lookup, not from the
    // format guard. A malformed UUID would 400 via a different path.
    const res = await request(app).get(`/api/p/00000000-0000-4000-8000-000000000000/securities-accounts`);
    expect(res.status).toBe(404);
  });
});
