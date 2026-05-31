// Regression for GitHub issue #24 — Empty brokerage account shows Euro value
// when portfolio and reference cash account are in USD.
//
// Root cause: GET /api/accounts builds the in-memory currencyById map from rows
// already filtered by isRetired=false. When a securities account's
// referenceAccount is retired (or otherwise excluded from the filtered list),
// the map lookup returns undefined and the resolved currency drops to null,
// even though the deposit row itself has a valid currency. The detail endpoint
// (GET /api/accounts/:id) does NOT have this bug — it queries the
// referenceAccount directly by id with no isRetired filter, matching the
// shape of the fix below.
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-accounts-list-retired-ref-ccy-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { seedFreshPortfolio } from './_helpers/portfolio-fixtures';

beforeAll(async () => {
  const { applyBootstrap } = await import('../db/apply-bootstrap');
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
});

describe('GET /accounts — currency resolution survives retired referenceAccount (issue #24)', () => {
  it('returns the deposit currency on the securities row even when the deposit is retired', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    // Create a USD deposit, repoint the securities account at it, then retire it.
    const usdDeposit = await request(app)
      .post(`/api/p/${portfolioId}/accounts`)
      .send({ name: 'USD Cash', type: 'account', currency: 'USD' });
    expect(usdDeposit.status, JSON.stringify(usdDeposit.body)).toBe(201);

    const listBefore = await request(app).get(`/api/p/${portfolioId}/accounts?includeRetired=true`);
    const securities = listBefore.body.find((a: { type: string }) => a.type === 'portfolio');
    expect(securities).toBeDefined();

    const repoint = await request(app)
      .put(`/api/p/${portfolioId}/accounts/${securities.id}`)
      .send({ referenceAccountId: usdDeposit.body.id });
    expect(repoint.status, JSON.stringify(repoint.body)).toBe(200);

    const retire = await request(app)
      .put(`/api/p/${portfolioId}/accounts/${usdDeposit.body.id}`)
      .send({ isRetired: true });
    expect(retire.status, JSON.stringify(retire.body)).toBe(200);

    // Bug surface: includeRetired=false drops the deposit row from the response
    // AND from the currency map. Pre-fix, securities.currency comes back null;
    // post-fix, it must still be 'USD' (matching the detail endpoint).
    const listAfter = await request(app).get(`/api/p/${portfolioId}/accounts`);
    expect(listAfter.status).toBe(200);
    const securitiesAfter = listAfter.body.find((a: { type: string }) => a.type === 'portfolio');
    expect(securitiesAfter).toBeDefined();
    expect(securitiesAfter.currency).toBe('USD');

    // Symmetry check: the detail endpoint already returns USD; the list
    // endpoint must now match.
    const detail = await request(app).get(`/api/p/${portfolioId}/accounts/${securities.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currency).toBe('USD');
  });
});
