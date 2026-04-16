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
  // Minimal columns required by the CHECKed/NOT-NULL ppxml2db schema.
  sqlite.prepare(
    `INSERT INTO account (_id, uuid, name, currency, type, updatedAt, _xmlid, _order)
     VALUES (1, 'a-1', 'A', 'EUR', 'account', '2026-01-01T00:00:00Z', 0, 0)`,
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

function summarize(id: string): Record<string, number> {
  const { sqlite } = acquirePortfolioDb(id);
  try {
    const accounts = (sqlite.prepare('SELECT COUNT(*) as n FROM account').get() as { n: number }).n;
    const xacts = (sqlite.prepare('SELECT COUNT(*) as n FROM xact').get() as { n: number }).n;
    const dashboards = (sqlite.prepare('SELECT COUNT(*) as n FROM vf_dashboard').get() as { n: number }).n;
    const chartCfg = (sqlite.prepare('SELECT COUNT(*) as n FROM vf_chart_config').get() as { n: number }).n;
    return { accounts, xacts, dashboards, chartCfg };
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
    const { entry: first } = await createPortfolio({ source: 'fresh', name: 'Roundtrip' });
    const { sqlite } = acquirePortfolioDb(first.id);
    try {
      seedTransactions(sqlite, 50);
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
      name: '',
      uploadedDbPath: out.filePath,
    });

    const a = summarize(first.id);
    const b = summarize(second.id);
    expect(b).toEqual(a);
  });
});
