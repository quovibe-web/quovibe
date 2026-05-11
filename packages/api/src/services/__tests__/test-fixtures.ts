// Shared in-memory SQLite fixture for service-layer tests.
//
// Schema is a superset of the ppxml2db tables the service layer reads/writes —
// individual test files use whichever subset they need. Keeping the superset
// here means new test files don't repeat ~130 lines of CREATE TABLE.
//
// Convention helpers (`shares` / `euros` / `price`) mirror the ppxml2db
// integer-quantization rules from `.claude/rules/db-schema.md`.

import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

export let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — tests using this helper should skipIf
}

export function createTestDb(): BetterSqlite3.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT,
      currency TEXT DEFAULT 'EUR',
      isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT,
      updatedAt TEXT,
      note TEXT,
      _xmlid INTEGER,
      _order INTEGER
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      isin TEXT,
      tickerSymbol TEXT,
      wkn TEXT,
      currency TEXT DEFAULT 'EUR',
      note TEXT,
      isRetired INTEGER DEFAULT 0,
      feedURL TEXT,
      feed TEXT,
      latestFeedURL TEXT,
      latestFeed TEXT,
      feedTickerSymbol TEXT,
      calendar TEXT,
      updatedAt TEXT,
      onlineId TEXT,
      targetCurrency TEXT
    );
    CREATE TABLE xact (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      amount INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      security TEXT,
      account TEXT NOT NULL DEFAULT '',
      source TEXT,
      updatedAt TEXT NOT NULL DEFAULT '',
      fees INTEGER NOT NULL DEFAULT 0,
      taxes INTEGER NOT NULL DEFAULT 0,
      acctype TEXT NOT NULL DEFAULT 'account',
      _xmlid INTEGER NOT NULL DEFAULT 0,
      _order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE xact_cross_entry (
      from_xact TEXT,
      from_acc TEXT,
      to_xact TEXT,
      to_acc TEXT,
      type TEXT
    );
    CREATE TABLE xact_unit (
      xact TEXT,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT,
      forex_amount INTEGER,
      forex_currency TEXT,
      exchangeRate TEXT
    );
    CREATE TABLE config_entry (
      uuid TEXT,
      config_set INTEGER,
      name TEXT NOT NULL,
      data TEXT
    );
    CREATE TABLE property (
      name TEXT PRIMARY KEY,
      special INTEGER NOT NULL DEFAULT 0,
      value TEXT
    );
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY,
      tstamp TEXT,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER
    );
    CREATE TABLE price (
      security TEXT,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER,
      PRIMARY KEY (security, tstamp)
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
      color TEXT NOT NULL,
      weight INTEGER NOT NULL,
      rank INTEGER NOT NULL
    );
    CREATE TABLE taxonomy_assignment (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy TEXT NOT NULL,
      category TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      rank INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE taxonomy_data (
      taxonomy TEXT NOT NULL,
      category TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL
    );
    CREATE TABLE taxonomy_assignment_data (
      assignment INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );
  `);
  db.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`).run('portfolio.currency', 'EUR');
  return db;
}

// ppxml2db quantization (see `.claude/rules/db-schema.md`):
//   shares:  integer × 1e8
//   amounts: integer × 100
//   prices:  integer × 1e8
export const shares = (n: number) => Math.round(n * 1e8); // native-ok
export const euros  = (n: number) => Math.round(n * 100); // native-ok
export const price  = (n: number) => Math.round(n * 1e8); // native-ok
