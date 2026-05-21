// packages/api/src/db/__tests__/apply-bootstrap-portfolio-base.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../apply-bootstrap';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
});

describe('seedPortfolioBaseCurrency (via applyBootstrap)', () => {
  it('writes baseCurrency = primary deposit ccy on first bootstrap with deposits', () => {
    applyBootstrap(db);
    db.prepare(`DELETE FROM vf_portfolio_meta WHERE key='baseCurrency'`).run();
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
       VALUES ('a1','Cash','account','GBP',0,'2025-01-01T00:00',1,0),
              ('a2','Other','account','USD',0,'2025-01-01T00:00',2,1)`,
    ).run();
    applyBootstrap(db); // re-run — should seed
    const row = db.prepare(`SELECT value FROM vf_portfolio_meta WHERE key='baseCurrency'`).get();
    expect(row).toEqual({ value: 'GBP' });
  });

  it('is idempotent — does not overwrite existing baseCurrency', () => {
    applyBootstrap(db);
    db.prepare(`INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency','JPY')`).run();
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
       VALUES ('a1','Cash','account','GBP',0,'2025-01-01T00:00',1,0)`,
    ).run();
    applyBootstrap(db);
    const row = db.prepare(`SELECT value FROM vf_portfolio_meta WHERE key='baseCurrency'`).get();
    expect(row).toEqual({ value: 'JPY' });
  });

  it('falls back to security ccy when no deposits exist', () => {
    applyBootstrap(db);
    db.prepare(`DELETE FROM vf_portfolio_meta WHERE key='baseCurrency'`).run();
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
       VALUES ('s1','TestSec','CHF',0,'2025-01-01T00:00')`,
    ).run();
    applyBootstrap(db);
    const row = db.prepare(`SELECT value FROM vf_portfolio_meta WHERE key='baseCurrency'`).get();
    expect(row).toEqual({ value: 'CHF' });
  });

  it('seeds EUR on first bootstrap of empty portfolio', () => {
    applyBootstrap(db);
    const row = db.prepare(`SELECT value FROM vf_portfolio_meta WHERE key='baseCurrency'`).get();
    expect(row).toEqual({ value: 'EUR' });
  });

  it('skips a non-ISO-4217 deposit ccy and falls through to the next tier', () => {
    applyBootstrap(db);
    db.prepare(`DELETE FROM vf_portfolio_meta WHERE key='baseCurrency'`).run();
    // Malformed legacy deposit currency (lowercase) — must be rejected.
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
       VALUES ('a1','Legacy','account','xx',0,'2025-01-01T00:00',1,0)`,
    ).run();
    // Valid security currency available as the next tier.
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
       VALUES ('s1','TestSec','CHF',0,'2025-01-01T00:00')`,
    ).run();
    applyBootstrap(db);
    const row = db.prepare(`SELECT value FROM vf_portfolio_meta WHERE key='baseCurrency'`).get();
    expect(row).toEqual({ value: 'CHF' });
  });
});
