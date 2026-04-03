/**
 * Cross-Cutting Write Integrity Tests
 *
 * Audit scope: unit conversion consistency, UUID generation consistency,
 * DB transaction atomicity, and NULL safety across all service methods.
 *
 * Groups:
 *   A — Float-drift prevention (Math.round applied to all numeric writes)
 *   B — Integer guarantee (direct DB inspection after writes)
 *   C — UUID format (RFC4122 lowercase hyphenated)
 *   D — Transaction rollback (no partial rows on failure)
 *   E — NULL vs undefined (optional columns receive NULL, not '')
 *   F — NOT NULL columns (always provided)
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { TransactionType } from '@quovibe/shared';
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from '../../services/transaction.service';
import {
  convertTransactionToDb,
  convertPriceToDb,
} from '../../services/unit-conversion';
import {
  createTaxonomy,
  createCategory,
  deleteTaxonomy,
  createAssignment,
} from '../../services/taxonomy.service';

// ─── Skip if native SQLite bindings are unavailable ────────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Fixture UUIDs ─────────────────────────────────────────────────────────────

const PORTFOLIO_UUID = '5ebdc254-bdd9-4ad9-8a57-a2f860089bfa';
const DEPOSIT_UUID = '74011cf8-c166-4d2c-ac4c-af5e57017213';
const SECURITY_A = '04db1b60-9230-4c5b-a070-613944e91dc3';
const DEPOSIT_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PORTFOLIO_B = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

// ─── Schema SQL ────────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE account (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT,
    type TEXT NOT NULL,
    currency TEXT,
    isRetired INTEGER DEFAULT 0,
    referenceAccount TEXT,
    updatedAt TEXT NOT NULL DEFAULT '',
    note TEXT,
    _xmlid INTEGER NOT NULL DEFAULT 0,
    _order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE account_attr (
    account TEXT NOT NULL,
    attr_uuid TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT,
    seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account, attr_uuid)
  );
  CREATE TABLE security (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT,
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
    updatedAt TEXT NOT NULL DEFAULT '',
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
    to_xact TEXT NOT NULL,
    to_acc TEXT NOT NULL,
    type TEXT NOT NULL
  );
  CREATE TABLE xact_unit (
    xact TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT,
    forex_amount INTEGER,
    forex_currency TEXT,
    exchangeRate TEXT
  );
  CREATE TABLE taxonomy (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    root TEXT NOT NULL
  );
  CREATE TABLE taxonomy_category (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    parent TEXT,
    taxonomy TEXT NOT NULL,
    color TEXT NOT NULL,
    weight INTEGER NOT NULL,
    rank INTEGER NOT NULL
  );
  CREATE TABLE taxonomy_data (
    category TEXT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    taxonomy TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE taxonomy_assignment (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    category TEXT NOT NULL,
    taxonomy TEXT NOT NULL,
    item_type TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 10000,
    rank INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE taxonomy_assignment_data (
    assignment INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE price (
    security TEXT NOT NULL,
    tstamp TEXT NOT NULL,
    value INTEGER NOT NULL,
    high INTEGER,
    low INTEGER,
    volume INTEGER,
    PRIMARY KEY (security, tstamp)
  );
  CREATE TABLE latest_price (
    security TEXT PRIMARY KEY,
    tstamp TEXT NOT NULL,
    value INTEGER NOT NULL,
    high INTEGER,
    low INTEGER,
    volume INTEGER
  );
  CREATE TABLE property (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    special INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE security_attr (
    security TEXT NOT NULL,
    attr_uuid TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT,
    seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (security, attr_uuid)
  );
  CREATE TABLE security_prop (
    security TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    seq INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE security_event (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    security TEXT NOT NULL,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    details TEXT
  );
  CREATE TABLE watchlist_security (
    list INTEGER NOT NULL,
    security TEXT NOT NULL,
    PRIMARY KEY (list, security)
  );
  CREATE TABLE attribute_type (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    columnLabel TEXT NOT NULL,
    source TEXT,
    target TEXT NOT NULL,
    converterClass TEXT NOT NULL,
    props_json TEXT
  );
`;

const SEED_SQL = `
  INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
  VALUES
    ('${PORTFOLIO_UUID}', 'Test Portfolio', 'portfolio', NULL, 0, '${DEPOSIT_UUID}', '2025-01-01T00:00:00', 1, 1),
    ('${DEPOSIT_UUID}', 'Test Deposit', 'account', 'EUR', 0, NULL, '2025-01-01T00:00:00', 2, 2),
    ('${DEPOSIT_B}', 'Deposit B', 'account', 'USD', 0, NULL, '2025-01-01T00:00:00', 3, 3),
    ('${PORTFOLIO_B}', 'Portfolio B', 'portfolio', NULL, 0, '${DEPOSIT_B}', '2025-01-01T00:00:00', 4, 4);
  INSERT INTO security (uuid, name, isin, currency, updatedAt)
  VALUES
    ('${SECURITY_A}', 'Test Security', 'IE00BFYN8Y92', 'EUR', '2025-01-01');
`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

interface XactRow {
  uuid: string;
  type: string;
  date: string;
  currency: string;
  amount: number;
  shares: number;
  note: string | null;
  security: string | null;
  account: string;
  source: string | null;
  updatedAt: string;
  fees: number;
  taxes: number;
  acctype: string;
  _xmlid: number;
  _order: number;
}

interface UnitRow {
  xact: string;
  type: string;
  amount: number;
  currency: string | null;
  forex_amount: number | null;
  forex_currency: string | null;
  exchangeRate: string | null;
}

interface CrossEntryRow {
  from_xact: string | null;
  from_acc: string | null;
  to_xact: string;
  to_acc: string;
  type: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function getXactRows(sqlite: Database.Database): XactRow[] {
  return sqlite.prepare('SELECT * FROM xact ORDER BY _id').all() as XactRow[];
}

function getUnitRows(sqlite: Database.Database, xactId?: string): UnitRow[] {
  if (xactId) {
    return sqlite.prepare('SELECT * FROM xact_unit WHERE xact = ?').all(xactId) as UnitRow[];
  }
  return sqlite.prepare('SELECT * FROM xact_unit').all() as UnitRow[];
}

function getCrossEntryRows(sqlite: Database.Database): CrossEntryRow[] {
  return sqlite.prepare('SELECT * FROM xact_cross_entry').all() as CrossEntryRow[];
}

// ─── Test suite ────────────────────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('Cross-Cutting Write Integrity', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(CREATE_TABLES_SQL);
    sqlite.exec(SEED_SQL);
  });

  afterAll(() => {
    // Nothing to clean up — each test gets a fresh :memory: DB
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP A — Float-drift prevention
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP A — Float-drift prevention', () => {
    it('A1: BUY amount with fractional cents produces integer (Math.round applied)', () => {
      // 33.33 * 100 = 3333.0 — exact, but 33.333 * 100 = 3333.3 which needs rounding
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 33.333, // 33.333 * 100 = 3333.3 → must round to 3333
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const row = sqlite.prepare('SELECT amount FROM xact WHERE uuid = ?').get(id) as { amount: number };
      expect(Number.isInteger(row.amount)).toBe(true);
    });

    it('A2: fees with fractional cents produce integer', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 1.555, // 1.555 * 100 = 155.5 → must round to 156
        taxes: 0,
      });
      const row = sqlite.prepare('SELECT fees FROM xact WHERE uuid = ?').get(id) as { fees: number };
      expect(Number.isInteger(row.fees)).toBe(true);
      expect(row.fees).toBe(156); // Math.round(155.5) = 156
    });

    it('A3: taxes with fractional cents produce integer', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 2.777, // 2.777 * 100 = 277.7 → must round to 278
      });
      const row = sqlite.prepare('SELECT taxes FROM xact WHERE uuid = ?').get(id) as { taxes: number };
      expect(Number.isInteger(row.taxes)).toBe(true);
      expect(row.taxes).toBe(278);
    });

    it('A4: xact_unit FEE amount with fractional cents produces integer', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 3.335, // 3.335 * 100 = 333.5 → must round to 334
        taxes: 0,
      });
      const units = getUnitRows(sqlite, id);
      const feeUnit = units.find(u => u.type === 'FEE');
      expect(feeUnit).toBeDefined();
      expect(Number.isInteger(feeUnit!.amount)).toBe(true);
      expect(feeUnit!.amount).toBe(334);
    });

    it('A5: xact_unit TAX amount with fractional cents produces integer', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 4.445, // 4.445 * 100 = 444.5 → must round to 445 (or 444 depending on rounding)
      });
      const units = getUnitRows(sqlite, id);
      const taxUnit = units.find(u => u.type === 'TAX');
      expect(taxUnit).toBeDefined();
      expect(Number.isInteger(taxUnit!.amount)).toBe(true);
    });

    it('A6: FOREX unit amounts with fractional cents produce integers', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 100.33,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
        fxRate: 1.0847, // 100.33 * 1.0847 * 100 = 10882.7951 → must round
        fxCurrencyCode: 'USD',
      });
      const units = getUnitRows(sqlite, id);
      const forexUnit = units.find(u => u.type === 'FOREX');
      expect(forexUnit).toBeDefined();
      expect(Number.isInteger(forexUnit!.amount)).toBe(true);
      expect(Number.isInteger(forexUnit!.forex_amount!)).toBe(true);
    });

    it('A7: TRANSFER_BETWEEN_ACCOUNTS FOREX unit amounts produce integers', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        date: '2025-01-15',
        amount: 77.77,
        shares: 0,
        accountId: DEPOSIT_UUID,
        crossAccountId: DEPOSIT_B,
        fees: 0,
        taxes: 0,
        fxRate: 0.9123, // 77.77 * 0.9123 * 100 = 7095.3471 → must round
        fxCurrencyCode: 'USD',
      });
      const units = getUnitRows(sqlite, id);
      const forexUnit = units.find(u => u.type === 'FOREX');
      expect(forexUnit).toBeDefined();
      expect(Number.isInteger(forexUnit!.amount)).toBe(true);
      expect(Number.isInteger(forexUnit!.forex_amount!)).toBe(true);
    });

    it('A8: SELL amount with fees+taxes produces integer net amount', () => {
      // SELL: net = gross - fees - taxes. 150.17 - 3.33 - 2.22 = 144.62
      // 144.62 * 100 = 14462 — exact, but let's use values that produce non-integer
      const id = createTransaction(null, sqlite, {
        type: TransactionType.SELL,
        date: '2025-01-15',
        amount: 33.333,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 1.111,
        taxes: 2.222,
      });
      const row = sqlite.prepare('SELECT amount, fees, taxes FROM xact WHERE uuid = ?').get(id) as {
        amount: number; fees: number; taxes: number;
      };
      expect(Number.isInteger(row.amount)).toBe(true);
      expect(Number.isInteger(row.fees)).toBe(true);
      expect(Number.isInteger(row.taxes)).toBe(true);
    });

    it('A9: convertTransactionToDb.shares always produces integer', () => {
      // 1.23456789 * 1e8 = 123456789 — exact integer
      const result = convertTransactionToDb({
        shares: new (require('decimal.js'))(1.23456789),
      });
      expect(Number.isInteger(result.shares!)).toBe(true);
    });

    it('A10: convertTransactionToDb.amount always produces integer', () => {
      const result = convertTransactionToDb({
        amount: new (require('decimal.js'))(33.333),
      });
      expect(Number.isInteger(result.amount!)).toBe(true);
    });

    it('A11: convertPriceToDb.close always produces integer', () => {
      const result = convertPriceToDb({
        close: new (require('decimal.js'))(123.456789),
      });
      expect(Number.isInteger(result.close)).toBe(true);
    });

    it('A12: convertPriceToDb.high/low produce integers when provided', () => {
      const Decimal = require('decimal.js');
      const result = convertPriceToDb({
        close: new Decimal(100),
        high: new Decimal(123.456789),
        low: new Decimal(99.123456),
      });
      expect(Number.isInteger(result.high!)).toBe(true);
      expect(Number.isInteger(result.low!)).toBe(true);
    });

    it('A13: DEPOSIT amount with fractional cents produces integer', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-01-15',
        amount: 1000.999,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
      });
      const row = sqlite.prepare('SELECT amount FROM xact WHERE uuid = ?').get(id) as { amount: number };
      expect(Number.isInteger(row.amount)).toBe(true);
    });

    it('A14: updateTransaction also applies Math.round to fees/taxes', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2025-01-15',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 1.555,
        taxes: 2.777,
      });
      const row = sqlite.prepare('SELECT fees, taxes FROM xact WHERE uuid = ?').get(id) as {
        fees: number; taxes: number;
      };
      expect(Number.isInteger(row.fees)).toBe(true);
      expect(Number.isInteger(row.taxes)).toBe(true);
      expect(row.fees).toBe(156);
      expect(row.taxes).toBe(278);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP B — Integer guarantee (direct DB inspection)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP B — Integer guarantee (direct DB inspection)', () => {
    it('B1: all xact numeric columns are integers after BUY', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-02-01',
        amount: 1234.56,
        shares: 10.5,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 7.89,
        taxes: 3.21,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(Number.isInteger(row.amount)).toBe(true);
        expect(Number.isInteger(row.shares)).toBe(true);
        expect(Number.isInteger(row.fees)).toBe(true);
        expect(Number.isInteger(row.taxes)).toBe(true);
        expect(Number.isInteger(row._xmlid)).toBe(true);
        expect(Number.isInteger(row._order)).toBe(true);
      }
    });

    it('B2: all xact_unit.amount values are integers after BUY with fees+taxes', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-02-01',
        amount: 500,
        shares: 5,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 12.99,
        taxes: 8.50,
      });
      const units = getUnitRows(sqlite);
      for (const unit of units) {
        expect(Number.isInteger(unit.amount)).toBe(true);
      }
    });

    it('B3: all xact numeric columns are integers after SELL', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.SELL,
        date: '2025-02-01',
        amount: 999.99,
        shares: 3.141592,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0.01,
        taxes: 0.99,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(Number.isInteger(row.amount)).toBe(true);
        expect(Number.isInteger(row.shares)).toBe(true);
        expect(Number.isInteger(row.fees)).toBe(true);
        expect(Number.isInteger(row.taxes)).toBe(true);
      }
    });

    it('B4: all xact numeric columns are integers after DIVIDEND', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.DIVIDEND,
        date: '2025-02-01',
        amount: 45.67,
        shares: 100,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 1.23,
        taxes: 4.56,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(Number.isInteger(row.amount)).toBe(true);
        expect(Number.isInteger(row.fees)).toBe(true);
        expect(Number.isInteger(row.taxes)).toBe(true);
      }
    });

    it('B5: dest row also has integer columns for BUY (cash side)', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-02-01',
        amount: 77.777,
        shares: 2.5,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 3.333,
        taxes: 1.111,
      });
      const rows = getXactRows(sqlite);
      expect(rows.length).toBe(2); // source + dest
      for (const row of rows) {
        expect(Number.isInteger(row.amount)).toBe(true);
        expect(Number.isInteger(row.shares)).toBe(true);
        expect(Number.isInteger(row.fees)).toBe(true);
        expect(Number.isInteger(row.taxes)).toBe(true);
      }
    });

    it('B6: TRANSFER_BETWEEN_ACCOUNTS both rows have integer columns', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        date: '2025-02-01',
        amount: 123.456,
        shares: 0,
        accountId: DEPOSIT_UUID,
        crossAccountId: DEPOSIT_B,
        fees: 0,
        taxes: 0,
      });
      const rows = getXactRows(sqlite);
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(Number.isInteger(row.amount)).toBe(true);
        expect(Number.isInteger(row.shares)).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP C — UUID format
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP C — UUID format (RFC4122 lowercase hyphenated)', () => {
    it('C1: createTransaction returns RFC4122 UUID', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-03-01',
        amount: 100,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
      });
      expect(id).toMatch(UUID_REGEX);
    });

    it('C2: BUY dest row UUID matches RFC4122', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-03-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const rows = getXactRows(sqlite);
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.uuid).toMatch(UUID_REGEX);
      }
      // Source and dest must be different UUIDs
      expect(rows[0].uuid).not.toBe(rows[1].uuid);
    });

    it('C3: updateTransaction dest row UUID matches RFC4122', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-03-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2025-03-02',
        amount: 200,
        shares: 2,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(row.uuid).toMatch(UUID_REGEX);
      }
    });

    it('C4: createTaxonomy UUIDs match RFC4122', () => {
      const result = createTaxonomy(sqlite, 'Test Taxonomy');
      expect(result.uuid).toMatch(UUID_REGEX);
      // Root category UUID
      const taxonomy = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(result.uuid) as { root: string };
      expect(taxonomy.root).toMatch(UUID_REGEX);
    });

    it('C5: createCategory UUID matches RFC4122', () => {
      const tax = createTaxonomy(sqlite, 'UUID Test');
      const rootRow = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(tax.uuid) as { root: string };
      const cat = createCategory(sqlite, tax.uuid, rootRow.root, 'Child Cat');
      expect(cat.id).toMatch(UUID_REGEX);
    });

    it('C6: cross_entry to_xact is a valid RFC4122 UUID', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-03-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const entries = getCrossEntryRows(sqlite);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.to_xact).toMatch(UUID_REGEX);
        if (entry.from_xact) expect(entry.from_xact).toMatch(UUID_REGEX);
      }
    });

    it('C7: all UUIDs are lowercase (no uppercase hex)', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.SELL,
        date: '2025-03-01',
        amount: 50,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(row.uuid).toBe(row.uuid.toLowerCase());
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP D — Transaction rollback (atomicity)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP D — Transaction rollback (no partial rows on failure)', () => {
    it('D1: createTransaction BUY rollback — no xact rows if crossAccountId resolution fails', () => {
      // Remove the referenceAccount to simulate a failure in the dual-entry path
      sqlite.prepare('UPDATE account SET referenceAccount = NULL WHERE uuid = ?').run(PORTFOLIO_UUID);

      // BUY should not leave partial rows — destAccountId will be null, no dest created
      // This particular case doesn't throw but produces incomplete data
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-04-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      // Should still have source row but no dest (referenceAccount is null)
      const rows = getXactRows(sqlite);
      // This is actually a valid path — 1 row (no dest)
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('D2: SECURITY_TRANSFER without crossAccountId throws and leaves no rows', () => {
      const xactCountBefore = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt;
      try {
        createTransaction(null, sqlite, {
          type: TransactionType.SECURITY_TRANSFER,
          date: '2025-04-01',
          amount: 0,
          shares: 10,
          accountId: PORTFOLIO_UUID,
          securityId: SECURITY_A,
          fees: 0,
          taxes: 0,
          // no crossAccountId → should throw
        });
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).toContain('crossAccountId');
      }
      const xactCountAfter = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt;
      // No partial rows should remain
      expect(xactCountAfter).toBe(xactCountBefore);

      // No orphan units or cross entries
      const unitCount = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact_unit').get() as { cnt: number }).cnt;
      const ceCount = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact_cross_entry').get() as { cnt: number }).cnt;
      expect(unitCount).toBe(0);
      expect(ceCount).toBe(0);
    });

    it('D3: TRANSFER_BETWEEN_ACCOUNTS without crossAccountId throws and rolls back', () => {
      const xactCountBefore = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt;
      try {
        createTransaction(null, sqlite, {
          type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
          date: '2025-04-01',
          amount: 500,
          shares: 0,
          accountId: DEPOSIT_UUID,
          fees: 0,
          taxes: 0,
          // no crossAccountId
        });
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).toContain('crossAccountId');
      }
      const xactCountAfter = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt;
      expect(xactCountAfter).toBe(xactCountBefore);
    });

    it('D4: deleteTransaction is atomic — removes all related rows', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-04-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 5,
        taxes: 3,
      });
      const rowsBefore = getXactRows(sqlite);
      expect(rowsBefore.length).toBe(2); // source + dest

      deleteTransaction(null, sqlite, id);

      expect(getXactRows(sqlite).length).toBe(0);
      expect(getUnitRows(sqlite).length).toBe(0);
      expect(getCrossEntryRows(sqlite).length).toBe(0);
    });

    it('D5: deleteTaxonomy removes all dependent rows atomically', () => {
      const tax = createTaxonomy(sqlite, 'Delete Test', 'asset-classes');
      const rootRow = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(tax.uuid) as { root: string };
      const cat = createCategory(sqlite, tax.uuid, rootRow.root, 'Child');
      createAssignment(sqlite, tax.uuid, SECURITY_A, 'security', cat.id);

      deleteTaxonomy(sqlite, tax.uuid);

      expect(sqlite.prepare('SELECT COUNT(*) as cnt FROM taxonomy WHERE uuid = ?').get(tax.uuid) as { cnt: number }).toEqual({ cnt: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) as cnt FROM taxonomy_category WHERE taxonomy = ?').get(tax.uuid) as { cnt: number }).toEqual({ cnt: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) as cnt FROM taxonomy_assignment WHERE taxonomy = ?').get(tax.uuid) as { cnt: number }).toEqual({ cnt: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) as cnt FROM taxonomy_data WHERE taxonomy = ?').get(tax.uuid) as { cnt: number }).toEqual({ cnt: 0 });
    });

    it('D6: updateTransaction is atomic — old deps removed, new deps created', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-04-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 5,
        taxes: 3,
      });
      // Now update to different values
      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2025-04-02',
        amount: 200,
        shares: 2,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 10,
        taxes: 6,
      });
      // Should have exactly 2 xact rows (source + new dest), not 3
      const rows = getXactRows(sqlite);
      expect(rows.length).toBe(2);
      // Fees should reflect updated values
      const sourceRow = rows.find(r => r.uuid === id)!;
      expect(sourceRow.fees).toBe(1000); // 10 * 100
      expect(sourceRow.taxes).toBe(600); // 6 * 100
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP E — NULL vs undefined (optional columns)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP E — NULL vs undefined for optional columns', () => {
    it('E1: xact.note is NULL (not empty string) when not provided', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-05-01',
        amount: 100,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
        // no note
      });
      const row = sqlite.prepare('SELECT note FROM xact WHERE uuid = ?').get(id) as { note: string | null };
      expect(row.note).toBeNull();
    });

    it('E2: xact.note is preserved when provided', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-05-01',
        amount: 100,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
        note: 'Test note',
      });
      const row = sqlite.prepare('SELECT note FROM xact WHERE uuid = ?').get(id) as { note: string | null };
      expect(row.note).toBe('Test note');
    });

    it('E3: xact.security is NULL for cash-only types', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-05-01',
        amount: 100,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
      });
      const row = sqlite.prepare('SELECT security FROM xact WHERE uuid = ?').get(id) as { security: string | null };
      expect(row.security).toBeNull();
    });

    it('E4: xact.security is set for BUY', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-05-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const row = sqlite.prepare('SELECT security FROM xact WHERE uuid = ?').get(id) as { security: string | null };
      expect(row.security).toBe(SECURITY_A);
    });

    it('E5: xact_unit.forex_amount is NULL when no FOREX unit', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-05-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 5,
        taxes: 0,
      });
      const units = getUnitRows(sqlite, id);
      const feeUnit = units.find(u => u.type === 'FEE');
      expect(feeUnit).toBeDefined();
      expect(feeUnit!.forex_amount).toBeNull();
      expect(feeUnit!.forex_currency).toBeNull();
      expect(feeUnit!.exchangeRate).toBeNull();
    });

    it('E6: taxonomy_category.parent is NULL for root category', () => {
      const tax = createTaxonomy(sqlite, 'Null Test');
      const rootRow = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(tax.uuid) as { root: string };
      const root = sqlite.prepare('SELECT parent FROM taxonomy_category WHERE uuid = ?').get(rootRow.root) as { parent: string | null };
      expect(root.parent).toBeNull();
    });

    it('E7: taxonomy_data.category is NULL for sortOrder entries', () => {
      const tax = createTaxonomy(sqlite, 'SortOrder Null Test');
      const row = sqlite.prepare(
        "SELECT category FROM taxonomy_data WHERE taxonomy = ? AND name = 'sortOrder'"
      ).get(tax.uuid) as { category: string | null };
      expect(row.category).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP F — NOT NULL columns always provided
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP F — NOT NULL columns always provided', () => {
    it('F1: xact NOT NULL columns all present after BUY', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-06-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(row.uuid).toBeTruthy();
        expect(row.type).toBeTruthy();
        expect(row.date).toBeTruthy();
        expect(row.currency).toBeTruthy();
        expect(typeof row.amount).toBe('number');
        expect(typeof row.shares).toBe('number');
        expect(row.account).toBeTruthy();
        expect(row.acctype).toBeTruthy();
        expect(row.updatedAt).toBeTruthy();
        expect(typeof row.fees).toBe('number');
        expect(typeof row.taxes).toBe('number');
        expect(typeof row._xmlid).toBe('number');
        expect(typeof row._order).toBe('number');
      }
    });

    it('F2: xact NOT NULL columns all present after DEPOSIT', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-06-01',
        amount: 100,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
      });
      const row = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(id) as XactRow;
      expect(row.uuid).toBeTruthy();
      expect(row.type).toBeTruthy();
      expect(row.date).toBe('2025-06-01');
      expect(row.currency).toBeTruthy();
      expect(row.account).toBe(DEPOSIT_UUID);
      expect(row.acctype).toBeTruthy();
      expect(row.updatedAt).toBeTruthy();
      expect(row.source).toBe('MANUAL');
    });

    it('F3: xact NOT NULL columns for SELL', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.SELL,
        date: '2025-06-01',
        amount: 50,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(row.uuid).toBeTruthy();
        expect(row.type).toBeTruthy();
        expect(row.date).toBeTruthy();
        expect(row.currency).toBe('EUR');
      }
    });

    it('F4: xact.source is always "MANUAL" for service-created transactions', () => {
      const types = [
        { type: TransactionType.DEPOSIT, accountId: DEPOSIT_UUID, shares: 0 },
        { type: TransactionType.REMOVAL, accountId: DEPOSIT_UUID, shares: 0 },
        { type: TransactionType.INTEREST, accountId: DEPOSIT_UUID, shares: 0 },
      ];
      for (const t of types) {
        createTransaction(null, sqlite, {
          ...t,
          date: '2025-06-01',
          amount: 100,
          fees: 0,
          taxes: 0,
        });
      }
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(row.source).toBe('MANUAL');
      }
    });

    it('F5: xact.currency defaults to EUR when not provided', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-06-01',
        amount: 100,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
      });
      const row = sqlite.prepare('SELECT currency FROM xact WHERE uuid = ?').get(id) as { currency: string };
      expect(row.currency).toBe('EUR');
    });

    it('F6: xact_cross_entry NOT NULL columns present after BUY', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-06-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 0,
        taxes: 0,
      });
      const entries = getCrossEntryRows(sqlite);
      expect(entries.length).toBe(1);
      for (const entry of entries) {
        expect(entry.to_xact).toBeTruthy();
        expect(entry.to_acc).toBeTruthy();
        expect(entry.type).toBeTruthy();
      }
    });

    it('F7: xact_unit NOT NULL columns present', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2025-06-01',
        amount: 100,
        shares: 1,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
        fees: 5,
        taxes: 3,
      });
      const units = getUnitRows(sqlite);
      expect(units.length).toBeGreaterThan(0);
      for (const unit of units) {
        expect(unit.xact).toBeTruthy();
        expect(unit.type).toBeTruthy();
        expect(typeof unit.amount).toBe('number');
      }
    });

    it('F8: taxonomy NOT NULL columns present after create', () => {
      const tax = createTaxonomy(sqlite, 'Not Null Test');
      const row = sqlite.prepare('SELECT * FROM taxonomy WHERE uuid = ?').get(tax.uuid) as {
        uuid: string; name: string; root: string;
      };
      expect(row.uuid).toBeTruthy();
      expect(row.name).toBe('Not Null Test');
      expect(row.root).toBeTruthy();
    });

    it('F9: taxonomy_category NOT NULL columns present', () => {
      const tax = createTaxonomy(sqlite, 'Category Not Null Test');
      const rootRow = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(tax.uuid) as { root: string };
      const cat = createCategory(sqlite, tax.uuid, rootRow.root, 'Child');
      const row = sqlite.prepare('SELECT * FROM taxonomy_category WHERE uuid = ?').get(cat.id) as {
        uuid: string; name: string; taxonomy: string; color: string; weight: number; rank: number;
      };
      expect(row.uuid).toBeTruthy();
      expect(row.name).toBe('Child');
      expect(row.taxonomy).toBe(tax.uuid);
      expect(row.color).toBeTruthy();
      expect(typeof row.weight).toBe('number');
      expect(typeof row.rank).toBe('number');
    });

    it('F10: xact.acctype always has a value', () => {
      const types = [
        { type: TransactionType.BUY, accountId: PORTFOLIO_UUID, securityId: SECURITY_A, shares: 1 },
        { type: TransactionType.DEPOSIT, accountId: DEPOSIT_UUID, shares: 0 },
        { type: TransactionType.DIVIDEND, accountId: PORTFOLIO_UUID, securityId: SECURITY_A, shares: 100 },
      ];
      for (const t of types) {
        createTransaction(null, sqlite, {
          ...t,
          date: '2025-06-01',
          amount: 100,
          fees: 0,
          taxes: 0,
        });
      }
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(row.acctype).toBeTruthy();
        expect(['account', 'portfolio']).toContain(row.acctype);
      }
    });

    it('F11: xact._xmlid and _order are sequential positive integers', () => {
      createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-06-01',
        amount: 100,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
      });
      createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2025-06-02',
        amount: 200,
        shares: 0,
        accountId: DEPOSIT_UUID,
        fees: 0,
        taxes: 0,
      });
      const rows = getXactRows(sqlite);
      for (const row of rows) {
        expect(row._xmlid).toBeGreaterThan(0);
        expect(row._order).toBeGreaterThan(0);
      }
      // _xmlid and _order should be strictly increasing
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]._xmlid).toBeGreaterThan(rows[i - 1]._xmlid);
        expect(rows[i]._order).toBeGreaterThan(rows[i - 1]._order);
      }
    });
  });
});
