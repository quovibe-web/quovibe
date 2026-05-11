// Integration test for createFreshImpl — M3 seeding (BUG-54/55 Phase 2 — Task 2.4).
//
// Locks the contract that `createPortfolio({ source: 'fresh', ... })` seeds the
// default M3 account layout: 1 securities account + 1 primary deposit (+ N
// extras), with the securities account's referenceAccount wired to the primary
// deposit's UUID. Drives the service directly — no HTTP — because the goal is
// to pin the service signature and the seeding side-effect, not the wire path
// (that's covered by welcome-flow.test.ts and other supertest suites).
//
// IMPORTANT — env hand-off: `config.ts` reads QUOVIBE_DATA_DIR /
// QUOVIBE_DEMO_SOURCE at module-load time, so this file MUST set them at the
// top BEFORE any api import. Mirrors securities-accounts-endpoint.test.ts.
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-fresh-seed-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';

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
  // Touch settings + boot-recovery so the registry pool is wired before any test runs.
  const { loadSettings } = await import('../services/settings.service');
  const { recoverFromInterruptedSwap } = await import('../services/boot-recovery');
  await import('../services/portfolio-registry');
  loadSettings();
  recoverFromInterruptedSwap();
});

describe('createFreshImpl — M3 seeding', () => {
  it('seeds 1 securities account + 1 deposit for minimal M3 payload', async () => {
    const { createPortfolio } = await import('../services/portfolio-manager');
    const { listSecuritiesAccounts } = await import('../services/accounts.service');
    const { acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool');

    const { entry } = await createPortfolio({
      source: 'fresh',
      name: 'Test Minimal',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
      extraDeposits: [],
    });

    const { sqlite } = acquirePortfolioDb(entry.id);
    try {
      const secs = listSecuritiesAccounts(sqlite);
      expect(secs).toHaveLength(1);
      expect(secs[0].name).toBe('Main Securities');
      expect(secs[0].referenceAccountId).not.toBeNull();

      const deposits = sqlite
        .prepare("SELECT name, currency FROM account WHERE type = 'account' ORDER BY _order")
        .all();
      expect(deposits).toEqual([{ name: 'Cash', currency: 'EUR' }]);
    } finally {
      releasePortfolioDb(entry.id);
    }
  });

  it('seeds 1 securities + 3 deposits for M3 payload with 2 extra deposits', async () => {
    const { createPortfolio } = await import('../services/portfolio-manager');
    const { listSecuritiesAccounts } = await import('../services/accounts.service');
    const { acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool');

    const { entry } = await createPortfolio({
      source: 'fresh',
      name: 'Test Multi',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'EUR Cash' },
      extraDeposits: [
        { name: 'USD Cash', currency: 'USD' },
        { name: 'GBP Cash', currency: 'GBP' },
      ],
    });

    const { sqlite } = acquirePortfolioDb(entry.id);
    try {
      expect(listSecuritiesAccounts(sqlite)).toHaveLength(1);
      const deposits = sqlite
        .prepare("SELECT name, currency FROM account WHERE type = 'account' ORDER BY _order")
        .all();
      expect(deposits).toEqual([
        { name: 'EUR Cash', currency: 'EUR' },
        { name: 'USD Cash', currency: 'USD' },
        { name: 'GBP Cash', currency: 'GBP' },
      ]);
    } finally {
      releasePortfolioDb(entry.id);
    }
  });

  it("wires securities.referenceAccount to the primary deposit's UUID", async () => {
    const { createPortfolio } = await import('../services/portfolio-manager');
    const { listSecuritiesAccounts } = await import('../services/accounts.service');
    const { acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool');

    const { entry } = await createPortfolio({
      source: 'fresh',
      name: 'Test Wiring',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Primary Cash' },
      extraDeposits: [],
    });

    const { sqlite } = acquirePortfolioDb(entry.id);
    try {
      const primary = sqlite
        .prepare("SELECT uuid FROM account WHERE type = 'account' AND name = 'Primary Cash'")
        .get() as { uuid: string };
      const sec = listSecuritiesAccounts(sqlite)[0];
      expect(sec.referenceAccountId).toBe(primary.uuid);
    } finally {
      releasePortfolioDb(entry.id);
    }
  });
});
