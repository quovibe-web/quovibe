// Regression lock for BUG-56: PUT /api/p/:pid/portfolio/settings is
// portfolio-scoped and must not accept user-level sidecar fields (theme,
// activeReportingPeriodId, language, ...). Those belong to the user sidecar
// and flow through PUT /api/settings/preferences. The shared schema is
// .strict(), so unknown keys reject with 400.
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-bug56-'));
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

describe('PUT /api/p/:pid/portfolio/settings — sidecar-field rejection (BUG-56)', () => {
  it('rejects theme with 400', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`/api/p/${portfolioId}/portfolio/settings`)
      .send({ theme: 'dark' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('rejects activeReportingPeriodId with 400', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`/api/p/${portfolioId}/portfolio/settings`)
      .send({ activeReportingPeriodId: 'ytd' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('rejects language with 400', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`/api/p/${portfolioId}/portfolio/settings`)
      .send({ language: 'it' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('rejects privacyMode with 400', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`/api/p/${portfolioId}/portfolio/settings`)
      .send({ privacyMode: true });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('rejects defaultDataSeriesTaxonomyId with 400', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`/api/p/${portfolioId}/portfolio/settings`)
      .send({ defaultDataSeriesTaxonomyId: 'default' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('still accepts DB-side portfolio fields (costMethod, currency, calendar)', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`/api/p/${portfolioId}/portfolio/settings`)
      .send({ costMethod: 'FIFO', currency: 'EUR', calendar: 'default' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config).toMatchObject({
      'portfolio.costMethod': 'FIFO',
      'portfolio.currency': 'EUR',
      'portfolio.calendar': 'default',
    });
  });

  it('rejects a mixed body containing one sidecar field alongside valid DB fields (atomic reject)', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`/api/p/${portfolioId}/portfolio/settings`)
      .send({ costMethod: 'FIFO', theme: 'light' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});
