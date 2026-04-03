// Data series filter structure tests

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { resolveDataSeries, resolveDataSeriesLabel } from '../data-series.service';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT,
      type TEXT,
      currency TEXT DEFAULT 'EUR',
      isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT,
      updatedAt TEXT,
      note TEXT,
      _xmlid INTEGER DEFAULT 0,
      _order INTEGER DEFAULT 0
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT,
      isin TEXT,
      tickerSymbol TEXT,
      currency TEXT DEFAULT 'EUR',
      isRetired INTEGER DEFAULT 0,
      updatedAt TEXT,
      onlineId TEXT,
      targetCurrency TEXT,
      note TEXT, wkn TEXT, feedURL TEXT, feed TEXT,
      latestFeedURL TEXT, latestFeed TEXT, feedTickerSymbol TEXT, calendar TEXT
    );
    CREATE TABLE taxonomy (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      root TEXT NOT NULL
    );
    CREATE TABLE taxonomy_category (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      taxonomy TEXT NOT NULL,
      parent TEXT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#000000',
      weight INTEGER NOT NULL DEFAULT 0,
      rank INTEGER NOT NULL DEFAULT 0
    );
  `);
  sqlite.exec(`
    INSERT INTO account (uuid, name, type, referenceAccount, updatedAt)
      VALUES ('acct-port-1', 'My Broker', 'portfolio', 'acct-dep-1', '2024-01-01');
    INSERT INTO account (uuid, name, type, currency, updatedAt)
      VALUES ('acct-dep-1', 'Cash EUR', 'account', 'EUR', '2024-01-01');
    INSERT INTO security (uuid, name, tickerSymbol, updatedAt)
      VALUES ('sec-1', 'Apple Inc', 'AAPL', '2024-01-01');
    INSERT INTO security (uuid, name, updatedAt)
      VALUES ('sec-2', 'Bond Fund', '2024-01-01');
    INSERT INTO taxonomy (uuid, name, root)
      VALUES ('tax-1', 'Asset Classes', 'root-1');
    INSERT INTO taxonomy_category (uuid, taxonomy, name)
      VALUES ('cat-1', 'tax-1', 'Equities');
  `);
  return sqlite;
}

(hasSqliteBindings ? describe : describe.skip)('resolveDataSeries', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it('portfolio → { preTax: false }', () => {
    const result = resolveDataSeries(db, { type: 'portfolio', preTax: false });
    expect(result).toEqual({ preTax: false });
  });

  it('account → { filter, withReference }', () => {
    const result = resolveDataSeries(db, { type: 'account', accountId: 'acct-port-1', withReference: true });
    expect(result).toEqual({ filter: 'acct-port-1', withReference: true });
  });

  it('account not found → throws 404', () => {
    expect(() => resolveDataSeries(db, { type: 'account', accountId: 'nonexistent', withReference: false }))
      .toThrow('Account not found');
  });

  it('taxonomy → { taxonomyId, categoryId }', () => {
    const result = resolveDataSeries(db, { type: 'taxonomy', taxonomyId: 'tax-1', categoryId: 'cat-1' });
    expect(result).toEqual({ taxonomyId: 'tax-1', categoryId: 'cat-1' });
  });

  it('taxonomy not found → throws 404', () => {
    expect(() => resolveDataSeries(db, { type: 'taxonomy', taxonomyId: 'nonexistent' }))
      .toThrow('Taxonomy not found');
  });

  it('security → { filter }', () => {
    const result = resolveDataSeries(db, { type: 'security', securityId: 'sec-1' });
    expect(result).toEqual({ filter: 'sec-1' });
  });

  it('security not found → throws 404', () => {
    expect(() => resolveDataSeries(db, { type: 'security', securityId: 'nonexistent' }))
      .toThrow('Security not found');
  });
});

(hasSqliteBindings ? describe : describe.skip)('resolveDataSeriesLabel', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it('portfolio preTax=false → "Entire portfolio"', () => {
    expect(resolveDataSeriesLabel(db, { type: 'portfolio', preTax: false })).toBe('Entire portfolio');
  });

  it('portfolio preTax=false → "Entire portfolio" (preTax=true removed from UI)', () => {
    expect(resolveDataSeriesLabel(db, { type: 'portfolio', preTax: false })).toBe('Entire portfolio');
  });

  it('account with referenceAccount → includes both names with "+"', () => {
    const label = resolveDataSeriesLabel(db, { type: 'account', accountId: 'acct-port-1', withReference: true });
    expect(label).toContain('My Broker');
    expect(label).toContain('+');
    expect(label).toContain('Cash EUR');
  });

  it('account without reference → just account name', () => {
    expect(resolveDataSeriesLabel(db, { type: 'account', accountId: 'acct-port-1', withReference: false })).toBe('My Broker');
  });

  it('taxonomy with categoryId → uses "›" separator', () => {
    const label = resolveDataSeriesLabel(db, { type: 'taxonomy', taxonomyId: 'tax-1', categoryId: 'cat-1' });
    expect(label).toContain('Asset Classes');
    expect(label).toContain('›');
    expect(label).toContain('Equities');
  });

  it('taxonomy without categoryId → just taxonomy name', () => {
    expect(resolveDataSeriesLabel(db, { type: 'taxonomy', taxonomyId: 'tax-1' })).toBe('Asset Classes');
  });

  it('security with ticker → "Name (TICKER)"', () => {
    expect(resolveDataSeriesLabel(db, { type: 'security', securityId: 'sec-1' })).toBe('Apple Inc (AAPL)');
  });

  it('security without ticker → just name', () => {
    expect(resolveDataSeriesLabel(db, { type: 'security', securityId: 'sec-2' })).toBe('Bond Fund');
  });
});
