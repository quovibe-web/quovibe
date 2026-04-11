// packages/api/src/routes/__tests__/securities-balance-decimal.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Decimal from 'decimal.js';
import { getSecuritiesBalance } from '../../services/accounts.service';

let hasSqliteBindings = false;
try { new Database(':memory:').close(); hasSqliteBindings = true; } catch { /* skip */ }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
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
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY, tstamp TEXT, value INTEGER NOT NULL
    );
    CREATE TABLE price (
      security TEXT, tstamp TEXT NOT NULL, value INTEGER NOT NULL,
      PRIMARY KEY (security, tstamp)
    );
  `);
  return db;
}

describe.skipIf(!hasSqliteBindings)('GAP-03: getSecuritiesBalance uses Decimal arithmetic', () => {
  let db: ReturnType<typeof Database>;

  beforeEach(() => { db = makeDb(); });

  it('3 shares × 0.1 EUR = exactly 0.3 (not 0.30000000000000004)', () => {
    // shares: 3 × 10^8 = 300_000_000; price: 0.1 × 10^8 = 10_000_000
    db.exec(`
      INSERT INTO xact VALUES
        (NULL, 'buy-1', 'BUY', '2024-01-01', 'EUR', 1000, 300000000, NULL, 'sec-1', 'port-1',
         'TEST', '2024-01-01', 0, 0, 'portfolio', 1, 1);
      INSERT INTO latest_price VALUES ('sec-1', '2024-06-01', 10000000);
    `);

    const balance = getSecuritiesBalance(db, 'port-1');
    // Decimal-exact: new Decimal('3').times(new Decimal('0.1')) = '0.3'
    expect(balance).toBe('0.3');
  });

  it('market value matches Decimal.js calculation for multiple positions', () => {
    // 10 shares of sec-1 at 12.34 EUR + 5 shares of sec-2 at 56.78 EUR
    // = 10 × 12.34 + 5 × 56.78 = 123.4 + 283.9 = 407.3
    db.exec(`
      INSERT INTO xact VALUES
        (NULL, 'buy-1', 'BUY', '2024-01-01', 'EUR', 1234, 1000000000, NULL, 'sec-1', 'port-1',
         'TEST', '2024-01-01', 0, 0, 'portfolio', 1, 1),
        (NULL, 'buy-2', 'BUY', '2024-01-01', 'EUR', 5678, 500000000, NULL, 'sec-2', 'port-1',
         'TEST', '2024-01-01', 0, 0, 'portfolio', 2, 2);
      INSERT INTO latest_price VALUES
        ('sec-1', '2024-06-01', 1234000000),
        ('sec-2', '2024-06-01', 5678000000);
    `);

    const balance = getSecuritiesBalance(db, 'port-1');
    const expected = new Decimal('10').times('12.34').plus(new Decimal('5').times('56.78')).toString();
    expect(balance).toBe(expected); // '407.3'
  });

  it('falls back to historical price when latest_price is absent', () => {
    db.exec(`
      INSERT INTO xact VALUES
        (NULL, 'buy-1', 'BUY', '2024-01-01', 'EUR', 1000, 200000000, NULL, 'sec-1', 'port-1',
         'TEST', '2024-01-01', 0, 0, 'portfolio', 1, 1);
      INSERT INTO price VALUES ('sec-1', '2024-05-01', 5000000000);
    `);

    const balance = getSecuritiesBalance(db, 'port-1');
    // 2 shares × 50 EUR = 100
    expect(balance).toBe('100');
  });

  it('returns 0 for account with no positions', () => {
    const balance = getSecuritiesBalance(db, 'empty-port');
    expect(balance).toBe('0');
  });
});
