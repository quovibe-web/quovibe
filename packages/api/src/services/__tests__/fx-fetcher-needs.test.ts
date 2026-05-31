import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { needsFxFetch } from '../fx-fetcher.service';

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      currency TEXT
    );
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      currency TEXT,
      type TEXT,
      _order INTEGER
    );
    CREATE TABLE vf_portfolio_meta (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
});

describe('needsFxFetch', () => {
  test('returns true when table is empty and foreign currencies exist', () => {
    db.exec(`INSERT INTO vf_portfolio_meta VALUES ('baseCurrency', 'EUR')`);
    db.exec(`INSERT INTO security (uuid, currency) VALUES ('sec1', 'USD')`);
    expect(needsFxFetch(db)).toBe(true);
  });

  test('returns false when table already has rates', () => {
    db.exec(`INSERT INTO vf_portfolio_meta VALUES ('baseCurrency', 'EUR')`);
    db.exec(`INSERT INTO security (uuid, currency) VALUES ('sec1', 'USD')`);
    db.exec(`INSERT INTO vf_exchange_rate VALUES ('2024-01-15', 'EUR', 'USD', '1.08')`);
    expect(needsFxFetch(db)).toBe(false);
  });

  test('returns false when all currencies match base', () => {
    db.exec(`INSERT INTO vf_portfolio_meta VALUES ('baseCurrency', 'EUR')`);
    db.exec(`INSERT INTO security (uuid, currency) VALUES ('sec1', 'EUR')`);
    db.exec(`INSERT INTO account (uuid, currency, type) VALUES ('acc1', 'EUR', 'portfolio')`);
    expect(needsFxFetch(db)).toBe(false);
  });

  test('returns false when no securities or accounts exist', () => {
    expect(needsFxFetch(db)).toBe(false);
  });

  test('detects foreign currency in accounts', () => {
    db.exec(`INSERT INTO vf_portfolio_meta VALUES ('baseCurrency', 'EUR')`);
    db.exec(`INSERT INTO account (uuid, currency, type) VALUES ('acc1', 'USD', 'account')`);
    expect(needsFxFetch(db)).toBe(true);
  });

  test('uses deposit account currency as default base when meta key absent', () => {
    // Base resolves from the first deposit account (EUR) when vf_portfolio_meta has no baseCurrency.
    db.exec(`INSERT INTO account (uuid, currency, type) VALUES ('acc1', 'EUR', 'account')`);
    db.exec(`INSERT INTO security (uuid, currency) VALUES ('sec1', 'USD')`);
    expect(needsFxFetch(db)).toBe(true);
  });
});
