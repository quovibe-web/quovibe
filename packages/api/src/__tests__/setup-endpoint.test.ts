// Integration test for POST /api/p/:pid/setup (BUG-54/55 Phase 2 — Task 2.5).
//
// Boundary-style supertest cases that drive the new route from the wire down
// to the seeding helper via the standard portfolio-context middleware. Reuses
// the shared fixtures in `_helpers/portfolio-fixtures.ts` so the seed shape
// stays in lock-step with `securities-accounts-endpoint.test.ts` and
// `portfolio-fresh-seeding.test.ts`.
//
// IMPORTANT — env hand-off: the helper imports `createApp` dynamically, but
// `config.ts` reads QUOVIBE_DATA_DIR / QUOVIBE_DEMO_SOURCE at module-load
// time, so this file MUST set them at the top BEFORE importing the helper.
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-setup-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import {
  seedFreshPortfolio,
  seedLegacyFreshPortfolio,
} from './_helpers/portfolio-fixtures';

beforeAll(async () => {
  // Seed the demo source DB so the registry's bootstrap pass is happy when the
  // app first boots. Mirrors securities-accounts-endpoint.test.ts.
  const { applyBootstrap } = await import('../db/apply-bootstrap');
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
});

describe('POST /api/p/:pid/setup', () => {
  it('seeds accounts and returns 200 for a legacy N=0 portfolio', async () => {
    const { portfolioId, app } = await seedLegacyFreshPortfolio();

    const res = await request(app)
      .post(`/api/p/${portfolioId}/setup`)
      .send({
        baseCurrency: 'EUR',
        securitiesAccountName: 'Main Securities',
        primaryDeposit: { name: 'Cash' },
        extraDeposits: [],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Roundtrip: the GET on the sibling route must now return one row.
    const listRes = await request(app).get(`/api/p/${portfolioId}/securities-accounts`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).toMatchObject({
      name: 'Main Securities',
      currency: null,
      referenceAccountId: expect.any(String),
    });
  });

  it('returns 409 ALREADY_SETUP for a portfolio that already has N>=1', async () => {
    // seedFreshPortfolio creates a portfolio with the M3 default seeding
    // (N=1 securities account), so the second POST must hit the guard.
    const { portfolioId, app } = await seedFreshPortfolio();

    const res = await request(app)
      .post(`/api/p/${portfolioId}/setup`)
      .send({
        baseCurrency: 'EUR',
        securitiesAccountName: 'X',
        primaryDeposit: { name: 'Y' },
        extraDeposits: [],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toEqual({ error: 'ALREADY_SETUP' });
  });

  it('returns 400 INVALID_INPUT when baseCurrency is missing', async () => {
    const { portfolioId, app } = await seedLegacyFreshPortfolio();

    const res = await request(app)
      .post(`/api/p/${portfolioId}/setup`)
      .send({
        securitiesAccountName: 'X',
        primaryDeposit: { name: 'Y' },
        extraDeposits: [],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
    expect(res.body.details).toBeDefined();
  });

  it('returns 409 DUPLICATE_NAME when primary and an extra deposit share a name', async () => {
    const { portfolioId, app } = await seedLegacyFreshPortfolio();

    const res = await request(app)
      .post(`/api/p/${portfolioId}/setup`)
      .send({
        baseCurrency: 'EUR',
        securitiesAccountName: 'Main Securities',
        primaryDeposit: { name: 'Cash' },
        extraDeposits: [{ name: 'Cash', currency: 'USD' }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toEqual({ error: 'DUPLICATE_NAME' });

    // Transactional rollback: the failed seed must not leave any partial
    // rows behind. The portfolio stays in its pre-call N=0 state.
    const listRes = await request(app).get(`/api/p/${portfolioId}/securities-accounts`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(0);
  });
});
