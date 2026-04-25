// Regression harness for BUG-62: UI was missing a post-create editor for a
// securities account's referenceAccountId. The server route has always accepted
// the field; this test pins the wire contract so the UI (ChangeReferenceAccountDialog)
// has something to regress against.
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-accounts-put-ref-'));
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

describe('PUT /accounts/:id referenceAccountId (BUG-62)', () => {
  it('reassigns referenceAccountId to a different same-currency deposit → 200', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    const list0 = await request(app).get(`/api/p/${portfolioId}/accounts?includeRetired=true`);
    expect(list0.status).toBe(200);
    const securities = list0.body.find((a: { type: string }) => a.type === 'portfolio');
    const primaryDeposit = list0.body.find((a: { type: string }) => a.type === 'account');
    expect(securities).toBeDefined();
    expect(primaryDeposit).toBeDefined();

    const second = await request(app).post(`/api/p/${portfolioId}/accounts`).send({
      name: 'Cash #2', type: 'account', currency: 'EUR',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    const put = await request(app).put(`/api/p/${portfolioId}/accounts/${securities.id}`).send({
      referenceAccountId: second.body.id,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.referenceAccountId).toBe(second.body.id);
    expect(put.body.id).toBe(securities.id);

    const flipBack = await request(app).put(`/api/p/${portfolioId}/accounts/${securities.id}`).send({
      referenceAccountId: primaryDeposit.id,
    });
    expect(flipBack.status).toBe(200);
    expect(flipBack.body.referenceAccountId).toBe(primaryDeposit.id);
  });

  it('unknown securities account id → 404', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const list = await request(app).get(`/api/p/${portfolioId}/accounts?includeRetired=true`);
    const primaryDeposit = list.body.find((a: { type: string }) => a.type === 'account');

    const bad = await request(app).put(`/api/p/${portfolioId}/accounts/ffffffff-ffff-ffff-ffff-ffffffffffff`).send({
      referenceAccountId: primaryDeposit.id,
    });
    expect(bad.status).toBe(404);
  });
});
