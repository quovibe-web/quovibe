// packages/api/src/__tests__/roundtrip.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

// Env wiring MUST land before any transitive import of `../config` resolves it.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-rt-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

// Deferred imports — resolved inside beforeAll so the TS modules go through
// Vitest's TypeScript pipeline (plain `require` of .ts files doesn't work here).
let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createPortfolio: typeof import('../services/portfolio-manager').createPortfolio;
let exportPortfolio: typeof import('../services/portfolio-manager').exportPortfolio;
let acquirePortfolioDb: typeof import('../services/portfolio-db-pool').acquirePortfolioDb;
let releasePortfolioDb: typeof import('../services/portfolio-db-pool').releasePortfolioDb;
let validateQuovibeDbFile: typeof import('../services/import-validation').validateQuovibeDbFile;

function seedTransactions(sqlite: Database.Database, n: number): void {
  // Strip the auto-seeded M3 default rows so this fixture controls the exact
  // account shape it asserts against (also clears _id=1/2 collisions).
  sqlite.prepare('DELETE FROM account').run();
  // Minimal columns required by the CHECKed/NOT-NULL ppxml2db schema.
  // Two accounts: one cash (Group B deposits) + one portfolio (Group A BUY double-entry).
  sqlite.prepare(
    `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (1, 'a-1', 'Cash', 'EUR', 'account', NULL, '2026-01-01T00:00:00Z', 0, 0)`,
  ).run();
  sqlite.prepare(
    `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (2, 'a-2', 'Broker', 'EUR', 'portfolio', 'a-1', '2026-01-01T00:00:00Z', 1, 1)`,
  ).run();

  const stmt = sqlite.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, note, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES (?, 'a-1', 'DEPOSIT', ?, ?, 0, NULL, 'EUR',
             'account', '2026-01-01T00:00:00Z', ?, ?, 0, 0)`,
  );
  for (let i = 0; i < n; i++) {
    stmt.run(
      `t-${i}`,
      `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      1000 * 100,      // amount in hecto-units
      i,               // _xmlid
      i,               // _order
    );
  }
}

/**
 * Seed a BUY double-entry + cross-entry + the supporting security/price/latest_price
 * rows. Exercises the full ADR-015 §3.3 transaction shape:
 *   - 1 security row
 *   - 1 price + 1 latest_price row
 *   - 2 xact rows (portfolio-side shares>0, cash-side shares=0)
 *   - 1 xact_cross_entry linking them (from_xact=portfolio, to_xact=cash).
 * Without this, `exportPortfolio` could silently drop cross-entry rows and the
 * test wouldn't notice (cross-entry is the single biggest complexity source per
 * `.claude/rules/double-entry.md`).
 */
function seedBuyWithCrossEntry(sqlite: Database.Database, baseOrder: number): void {
  sqlite.prepare(
    `INSERT INTO security (_id, uuid, name, currency, isin, isRetired, updatedAt)
     VALUES (1, 's-1', 'Acme Corp', 'EUR', 'US0000000001', 0, '2026-01-01T00:00:00Z')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO price (security, tstamp, value) VALUES ('s-1', '2026-01-15', ?)`,
  ).run(10000 * 1e8);   // price 100.00 in ppxml2db scaled units
  sqlite.prepare(
    `INSERT INTO latest_price (security, tstamp, value) VALUES ('s-1', '2026-01-20', ?)`,
  ).run(10250 * 1e8);

  // Portfolio-side BUY (shares > 0)
  sqlite.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('buy-p', 'a-2', 'BUY', '2026-01-15', ?, ?, 's-1', 'EUR',
             'portfolio', '2026-01-15T00:00:00Z', ?, ?, 0, 0)`,
  ).run(500000, 10 * 1e8, baseOrder, baseOrder);
  // Cash-side counter-entry (shares = 0, same security per D4 fix)
  sqlite.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('buy-c', 'a-1', 'BUY', '2026-01-15', ?, 0, 's-1', 'EUR',
             'account', '2026-01-15T00:00:00Z', ?, ?, 0, 0)`,
  ).run(500000, baseOrder + 1, baseOrder + 1);
  sqlite.prepare(
    `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
     VALUES ('buy-p', 'a-2', 'buy-c', 'a-1', 'buysell')`,
  ).run();
}

function summarize(id: string): Record<string, number> {
  const { sqlite } = acquirePortfolioDb(id);
  try {
    const c = (sql: string): number =>
      (sqlite.prepare(sql).get() as { n: number }).n;
    return {
      accounts:        c('SELECT COUNT(*) as n FROM account'),
      xacts:           c('SELECT COUNT(*) as n FROM xact'),
      crossEntries:    c('SELECT COUNT(*) as n FROM xact_cross_entry'),
      securities:      c('SELECT COUNT(*) as n FROM security'),
      prices:          c('SELECT COUNT(*) as n FROM price'),
      latestPrices:    c('SELECT COUNT(*) as n FROM latest_price'),
      portfolioMeta:   c('SELECT COUNT(*) as n FROM vf_portfolio_meta'),
      dashboards:      c('SELECT COUNT(*) as n FROM vf_dashboard'),
      chartCfg:        c('SELECT COUNT(*) as n FROM vf_chart_config'),
    };
  } finally {
    releasePortfolioDb(id);
  }
}

/** Read vf_portfolio_meta as a map — proves key/value round-trip (not just count). */
function readMeta(id: string): Record<string, string> {
  const { sqlite } = acquirePortfolioDb(id);
  try {
    const rows = sqlite.prepare('SELECT key, value FROM vf_portfolio_meta').all() as
      Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } finally {
    releasePortfolioDb(id);
  }
}

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));

  // Seed a minimal demo source so portfolio-manager's createPortfolio({ source:'demo' })
  // would find it (not used by this suite directly, but boot code may read DEMO_SOURCE_PATH).
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }

  ({ createPortfolio, exportPortfolio } = await import('../services/portfolio-manager'));
  // Importing portfolio-registry wires setResolveEntry on the pool.
  await import('../services/portfolio-registry');
  ({ acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool'));
  ({ validateQuovibeDbFile } = await import('../services/import-validation'));
});

describe('Gate 4: portfolio .db roundtrip', () => {
  it('export → import produces identical summaries', async () => {
    const { entry: first } = await createPortfolio({
      source: 'fresh', name: 'Roundtrip',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
      extraDeposits: [],
    });
    const { sqlite } = acquirePortfolioDb(first.id);
    try {
      seedTransactions(sqlite, 50);
      // Group A BUY double-entry + cross-entry + security/price/latest_price
      seedBuyWithCrossEntry(sqlite, 50);
      // Seed an extra dashboard + chart-config entry
      sqlite.prepare(
        `INSERT INTO vf_dashboard (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
         VALUES ('d-extra','Second',1,'[]',1,3,'2026-01-01','2026-01-01')`,
      ).run();
      sqlite.prepare(
        `INSERT INTO vf_chart_config (chart_id, config_json, schema_version, updatedAt)
         VALUES ('performance-main','{"seriesRefs":[],"visibility":{},"benchmarks":[]}',1,'2026-01-01')`,
      ).run();
    } finally {
      releasePortfolioDb(first.id);
    }

    const out = await exportPortfolio(first.id);
    expect(fs.existsSync(out.filePath)).toBe(true);
    validateQuovibeDbFile(out.filePath);

    const { entry: second } = await createPortfolio({
      source: 'import-quovibe-db',
      uploadedDbPath: out.filePath,
    });

    const a = summarize(first.id);
    const b = summarize(second.id);
    expect(b).toEqual(a);

    // vf_portfolio_meta drives rebuildRegistryFromDbs — a count match alone
    // wouldn't prove the key/value payload survived. Compare the full map.
    expect(readMeta(second.id)).toEqual(readMeta(first.id));
  });
});
