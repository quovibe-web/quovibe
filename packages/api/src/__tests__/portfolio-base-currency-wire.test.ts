// Regression test: GET /api/portfolio returns the canonical baseCurrency from
// vf_portfolio_meta for every portfolio creation path, so the frontend shows
// the correct currency symbol on first paint without requiring a Settings toggle.
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-base-currency-wire-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';

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

async function buildApp() {
  const { createApp } = await import('../create-app');
  const { loadSettings } = await import('../services/settings.service');
  const { recoverFromInterruptedSwap } = await import('../services/boot-recovery');
  await import('../services/portfolio-registry');
  loadSettings();
  recoverFromInterruptedSwap();
  return createApp();
}

describe('GET /api/portfolio — baseCurrency wire field', () => {
  it('returns canonical USD for a fresh M3 USD portfolio (no property rows written)', async () => {
    const app = await buildApp();
    const { createPortfolio } = await import('../services/portfolio-manager');
    const { entry } = await createPortfolio({
      source: 'fresh',
      name: `BaseCcy-USD-${Date.now()}`,
      baseCurrency: 'USD',
      securitiesAccountName: 'Main',
      primaryDeposit: { name: 'Cash USD' },
      extraDeposits: [],
    });

    const res = await request(app).get(`/api/p/${entry.id}/portfolio`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.baseCurrency).toBe('USD');
    // portfolio.currency must NOT be present (user has not saved Settings yet)
    expect(res.body.config['portfolio.currency']).toBeUndefined();
  });

  it('returns canonical USD for a PP-XML-style portfolio (vf_portfolio_meta seeded directly)', async () => {
    const app = await buildApp();
    const { createPortfolio } = await import('../services/portfolio-manager');
    const { acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool');

    // Create fresh EUR portfolio, then manually override vf_portfolio_meta to simulate PP-XML import
    const { entry } = await createPortfolio({
      source: 'fresh',
      name: `BaseCcy-PPXML-${Date.now()}`,
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main',
      primaryDeposit: { name: 'Cash EUR' },
      extraDeposits: [],
    });

    const h = acquirePortfolioDb(entry.id);
    try {
      h.sqlite
        .prepare(`UPDATE vf_portfolio_meta SET value = 'USD' WHERE key = 'baseCurrency'`)
        .run();
    } finally {
      releasePortfolioDb(entry.id);
    }

    const res = await request(app).get(`/api/p/${entry.id}/portfolio`);
    expect(res.status).toBe(200);
    expect(res.body.config.baseCurrency).toBe('USD');
  });

  it('canonical baseCurrency is unaffected by a user-override (portfolio.currency is a separate key)', async () => {
    const app = await buildApp();
    const { createPortfolio } = await import('../services/portfolio-manager');

    const { entry } = await createPortfolio({
      source: 'fresh',
      name: `BaseCcy-Override-${Date.now()}`,
      baseCurrency: 'USD',
      securitiesAccountName: 'Main',
      primaryDeposit: { name: 'Cash USD' },
      extraDeposits: [],
    });

    // User saves a different currency in Settings
    await request(app)
      .put(`/api/p/${entry.id}/portfolio/settings`)
      .send({ currency: 'JPY' });

    const res = await request(app).get(`/api/p/${entry.id}/portfolio`);
    expect(res.status).toBe(200);
    // canonical stays USD (from vf_portfolio_meta)
    expect(res.body.config.baseCurrency).toBe('USD');
    // user override on the separate key
    expect(res.body.config['portfolio.currency']).toBe('JPY');
  });
});
