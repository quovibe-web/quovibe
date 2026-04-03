/**
 * BUY/SELL Write-Parity Tests
 *
 * Ground truth: docs/audit/fixtures/xact-buy.json, xact-sell.json
 * Spec: docs/audit/specs/01-buy-sell-spec.md
 *
 * Strategy:
 *   - Call service write methods (createTransaction, updateTransaction, deleteTransaction)
 *   - Read back raw rows with direct SQL (never through service read layer)
 *   - Compare every column against fixture-derived expected values
 *
 * Known divergences documented in 01-buy-sell-spec.md:
 *   D4 (CRITICAL): Cash-side security is NULL in code but should be security UUID
 *   D2/D3/D5 (MEDIUM): Missing Math.round() on amount/fees/taxes/unit conversions
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { TransactionType } from '@quovibe/shared';
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from '../../services/transaction.service';

// ─── Skip if native SQLite bindings are unavailable ────────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Fixture UUIDs (from docs/audit/fixtures/) ────────────────────────────────

const PORTFOLIO_UUID = '5ebdc254-bdd9-4ad9-8a57-a2f860089bfa';
const DEPOSIT_UUID = '74011cf8-c166-4d2c-ac4c-af5e57017213';
const SECURITY_A = '04db1b60-9230-4c5b-a070-613944e91dc3';
const SECURITY_B = '99401ac3-2a74-4078-b15d-56c5868db9dd';

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
`;

const SEED_SQL = `
  INSERT INTO account (_id, uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
  VALUES
    (1, '${PORTFOLIO_UUID}', 'Test Portfolio', 'portfolio', NULL, 0, '${DEPOSIT_UUID}', '', 1, 1),
    (2, '${DEPOSIT_UUID}', 'Test Deposit', 'account', 'EUR', 0, NULL, '', 2, 2);
  INSERT INTO security (_id, uuid, name, isin, currency, updatedAt)
  VALUES
    (1, '${SECURITY_A}', 'VanEck ESPO', 'IE00BFYN8Y92', 'EUR', ''),
    (2, '${SECURITY_B}', 'iShares STOXX 600', 'DE0002635307', 'EUR', '');
`;

// ─── Raw DB row types ──────────────────────────────────────────────────────────

interface XactRow {
  _id: number;
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

interface CrossEntryRow {
  from_xact: string | null;
  from_acc: string | null;
  to_xact: string;
  to_acc: string;
  type: string;
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createTestDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('foreign_keys = OFF');
  db.pragma('journal_mode = WAL');
  db.exec(CREATE_TABLES_SQL);
  db.exec(SEED_SQL);
  return db;
}

function readXact(db: Database.Database, uuid: string): XactRow | undefined {
  return db.prepare('SELECT * FROM xact WHERE uuid = ?').get(uuid) as XactRow | undefined;
}

function readAllXact(db: Database.Database): XactRow[] {
  return db.prepare('SELECT * FROM xact ORDER BY _id').all() as XactRow[];
}

function readCrossEntries(db: Database.Database, fromXact: string): CrossEntryRow[] {
  return db.prepare('SELECT * FROM xact_cross_entry WHERE from_xact = ?').all(fromXact) as CrossEntryRow[];
}

function readAllCrossEntries(db: Database.Database): CrossEntryRow[] {
  return db.prepare('SELECT * FROM xact_cross_entry').all() as CrossEntryRow[];
}

function readUnits(db: Database.Database, xactId: string): UnitRow[] {
  return db.prepare('SELECT * FROM xact_unit WHERE xact = ?').all(xactId) as UnitRow[];
}

function readAllUnits(db: Database.Database): UnitRow[] {
  return db.prepare('SELECT * FROM xact_unit').all() as UnitRow[];
}

function uniqueDbPath(label: string): string {
  return join(tmpdir(), `audit-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

function cleanupDb(db: Database.Database, path: string): void {
  db.close();
  if (existsSync(path)) unlinkSync(path);
}

// =============================================================================
// TEST GROUP: BUY write
// =============================================================================

describe.skipIf(!hasSqliteBindings)('BUY write parity', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let buyId1: string; // BUY with fees only (fixture Row #1 equivalent)
  let buyId2: string; // BUY with fees + taxes (fixture Row #3 equivalent)

  beforeAll(() => {
    dbPath = uniqueDbPath('buy');
    sqlite = createTestDb(dbPath);

    // BUY #1: derived from fixture Row #1
    // Fixture: amount=79316, fees=500, taxes=0, shares=2400000000
    // Reverse: gross = (79316 - 500) / 100 = 788.16
    buyId1 = createTransaction(null, sqlite, {
      type: TransactionType.BUY,
      date: '2024-01-15',
      amount: 788.16,
      shares: 24,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 5,
      taxes: 0,
      note: 'Ordine C4615422561138',
    });

    // BUY #2: derived from fixture Row #3
    // Fixture: amount=3856602, fees=500, taxes=61802, shares=38000000000
    // Reverse: gross = (3856602 - 500 - 61802) / 100 = 37943
    buyId2 = createTransaction(null, sqlite, {
      type: TransactionType.BUY,
      date: '2024-01-17T10:00',
      amount: 37943,
      shares: 380,
      securityId: SECURITY_B,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 5,
      taxes: 618.02,
      note: 'tasse = rateo meno tasse',
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  // ── T1.1 — Securities-side xact row ────────────────────────────────────────

  describe('T1.1 — xact securities-side row', () => {
    it('xact.type = BUY', () => {
      // Prevents type mapping errors (BUY must not be remapped like DIVIDEND→DIVIDENDS)
      const row = readXact(sqlite, buyId1)!;
      expect(row.type).toBe('BUY');
    });

    it('xact.account = portfolio UUID', () => {
      // Securities-side must reference the portfolio, not the deposit
      const row = readXact(sqlite, buyId1)!;
      expect(row.account).toBe(PORTFOLIO_UUID);
    });

    it('xact.acctype = portfolio', () => {
      // Prevents acctype being defaulted to "account" for portfolio transactions
      const row = readXact(sqlite, buyId1)!;
      expect(row.acctype).toBe('portfolio');
    });

    it('xact.security = security UUID (non-null)', () => {
      // BUY must always reference a security on the securities-side
      const row = readXact(sqlite, buyId1)!;
      expect(row.security).toBe(SECURITY_A);
    });

    it('xact.amount = 79316 (net settlement in hecto-units)', () => {
      // BUY outflow: net = (gross + fees + taxes) * 100 = (788.16 + 5 + 0) * 100
      const row = readXact(sqlite, buyId1)!;
      expect(row.amount).toBe(79316);
    });

    it('xact.shares = 2400000000 (24 shares x 10^8)', () => {
      // Prevents unit conversion errors in shares
      const row = readXact(sqlite, buyId1)!;
      expect(row.shares).toBe(2400000000);
    });

    it('xact.fees = 500 (5 EUR x 100)', () => {
      // Fees stored as hecto-units
      const row = readXact(sqlite, buyId1)!;
      expect(row.fees).toBe(500);
    });

    it('xact.taxes = 0', () => {
      // Zero taxes stored as integer 0, not null
      const row = readXact(sqlite, buyId1)!;
      expect(row.taxes).toBe(0);
    });

    it('xact.currency = EUR', () => {
      // Currency resolved from account/referenceAccount chain
      const row = readXact(sqlite, buyId1)!;
      expect(row.currency).toBe('EUR');
    });

    it('xact.date preserved as-is', () => {
      // Service must not reformat or truncate the date
      const row = readXact(sqlite, buyId1)!;
      expect(row.date).toBe('2024-01-15');
    });

    it('xact.note = input note', () => {
      const row = readXact(sqlite, buyId1)!;
      expect(row.note).toBe('Ordine C4615422561138');
    });

    it('xact.source = MANUAL', () => {
      // Service-created transactions always get source=MANUAL
      const row = readXact(sqlite, buyId1)!;
      expect(row.source).toBe('MANUAL');
    });

    it('xact.updatedAt is a valid ISO datetime', () => {
      const row = readXact(sqlite, buyId1)!;
      expect(row.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ── T1.2 — Cash-side xact row ─────────────────────────────────────────────

  describe('T1.2 — xact cash-side row', () => {
    let cashRow!: XactRow;

    beforeAll(() => {
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries).toHaveLength(1);
      const row = readXact(sqlite, entries[0].to_xact);
      expect(row).toBeDefined();
      cashRow = row!;
    });

    it('xact.type = BUY (same as securities-side)', () => {
      // Cash-side must have the same type, not a special marker
      expect(cashRow.type).toBe('BUY');
    });

    it('xact.account = deposit UUID (referenceAccount)', () => {
      // Cash-side must point to the deposit account for balance tracking
      expect(cashRow.account).toBe(DEPOSIT_UUID);
    });

    it('xact.acctype = account', () => {
      // Deposit account type is "account"
      expect(cashRow.acctype).toBe('account');
    });

    it('xact.security = security UUID (D4: ppxml2db stores security on both rows)', () => {
      // CRITICAL: ppxml2db fixture (xact-buy.json Row #2) shows security = SECURITY_A.
      // Without this, queries filtering by security miss the cash impact.
      expect(cashRow.security).toBe(SECURITY_A);
    });

    it('xact.shares = 0 (integer zero, not NULL)', () => {
      // Cash-side has no shares but must be 0 for the exclusion filter to work:
      // NOT (type IN ('BUY','SELL') AND shares = 0)
      expect(cashRow.shares).toBe(0);
    });

    it('xact.amount = 79316 (identical to securities-side)', () => {
      // Both rows must have the same net settlement for balance correctness
      expect(cashRow.amount).toBe(79316);
    });

    it('xact.fees = 0 (fees live on securities-side only)', () => {
      // Prevents double-counting of fees in balance calculations
      expect(cashRow.fees).toBe(0);
    });

    it('xact.taxes = 0 (taxes live on securities-side only)', () => {
      // Prevents double-counting of taxes
      expect(cashRow.taxes).toBe(0);
    });

    it('xact.currency = EUR (same as securities-side)', () => {
      expect(cashRow.currency).toBe('EUR');
    });

    it('xact.date = same as securities-side', () => {
      // Both rows must have identical dates for chronological consistency
      expect(cashRow.date).toBe('2024-01-15');
    });

    it('xact.note = same as securities-side', () => {
      expect(cashRow.note).toBe('Ordine C4615422561138');
    });

    it('xact.source = MANUAL', () => {
      expect(cashRow.source).toBe('MANUAL');
    });
  });

  // ── T1.3 — xact_cross_entry ───────────────────────────────────────────────

  describe('T1.3 — xact_cross_entry', () => {
    it('exactly one cross_entry per BUY', () => {
      // BUY/SELL creates exactly 1 cross_entry linking the pair
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries).toHaveLength(1);
    });

    it('xact_cross_entry.from_xact = securities-side UUID', () => {
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries[0].from_xact).toBe(buyId1);
    });

    it('xact_cross_entry.to_xact != from_xact (not self-referential)', () => {
      // Self-referential cross_entry breaks double-entry accounting
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries[0].to_xact).not.toBe(entries[0].from_xact);
    });

    it('xact_cross_entry.from_acc = portfolio UUID', () => {
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries[0].from_acc).toBe(PORTFOLIO_UUID);
    });

    it('xact_cross_entry.to_acc = deposit UUID', () => {
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries[0].to_acc).toBe(DEPOSIT_UUID);
    });

    it('xact_cross_entry.from_acc != to_acc', () => {
      // Same account on both sides means the cross_entry is malformed
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries[0].from_acc).not.toBe(entries[0].to_acc);
    });

    it('xact_cross_entry.type = buysell', () => {
      // ppxml2db convention for BUY/SELL cross entries
      const entries = readCrossEntries(sqlite, buyId1);
      expect(entries[0].type).toBe('buysell');
    });

    it('to_xact resolves to an actual cash-side xact row', () => {
      // The UUID in to_xact must point to a real xact row in the deposit account
      const entries = readCrossEntries(sqlite, buyId1);
      const cashRow = readXact(sqlite, entries[0].to_xact);
      expect(cashRow).toBeDefined();
      expect(cashRow!.account).toBe(DEPOSIT_UUID);
    });
  });

  // ── T1.4 — xact_unit GROSS_VALUE ──────────────────────────────────────────

  describe('T1.4 — xact_unit GROSS_VALUE', () => {
    it('NO GROSS_VALUE unit exists (ppxml2db does not create one for BUY)', () => {
      // Fixture xact-buy.json shows only FEE/TAX units, never GROSS_VALUE.
      // Spec 01-buy-sell-spec.md section D1 confirms this.
      const units = readUnits(sqlite, buyId1);
      expect(units.find(u => u.type === 'GROSS_VALUE')).toBeUndefined();
    });

    it('also absent for BUY with fees + taxes', () => {
      const units = readUnits(sqlite, buyId2);
      expect(units.find(u => u.type === 'GROSS_VALUE')).toBeUndefined();
    });
  });

  // ── T1.5 — xact_unit FEE ──────────────────────────────────────────────────

  describe('T1.5 — xact_unit FEE', () => {
    it('FEE unit exists when fees > 0', () => {
      // Fixture Row #1: fees=500, has one FEE unit
      const units = readUnits(sqlite, buyId1);
      expect(units.find(u => u.type === 'FEE')).toBeDefined();
    });

    it('xact_unit.amount = 500 (5 EUR in hecto-units x10^2)', () => {
      // xact_unit amounts are in hecto-units (x10^2), matching xact.fees scale
      const units = readUnits(sqlite, buyId1);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee.amount).toBe(500);
    });

    it('xact_unit.xact = securities-side UUID (never cash-side)', () => {
      // All units must bind to Row 1 (securities-side)
      const units = readUnits(sqlite, buyId1);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee.xact).toBe(buyId1);
    });

    it('xact_unit.currency = EUR', () => {
      const units = readUnits(sqlite, buyId1);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee.currency).toBe('EUR');
    });

    it('xact_unit forex fields are all NULL (no cross-currency)', () => {
      // Fixture: forex_amount=null, forex_currency=null, exchangeRate=null
      const units = readUnits(sqlite, buyId1);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee.forex_amount).toBeNull();
      expect(fee.forex_currency).toBeNull();
      expect(fee.exchangeRate).toBeNull();
    });

    it('no xact_unit rows on cash-side', () => {
      // ppxml2db creates NO xact_unit rows for the cash-side (fixture Row #2: empty array)
      const entries = readCrossEntries(sqlite, buyId1);
      const cashUnits = readUnits(sqlite, entries[0].to_xact);
      expect(cashUnits).toHaveLength(0);
    });

    it('no TAX unit when taxes = 0', () => {
      // buyId1 has taxes=0, so no TAX unit should exist
      const units = readUnits(sqlite, buyId1);
      expect(units.find(u => u.type === 'TAX')).toBeUndefined();
    });
  });

  // ── T1.6 — xact_unit TAX ──────────────────────────────────────────────────

  describe('T1.6 — xact_unit TAX (BUY with fees + taxes)', () => {
    it('TAX unit exists when taxes > 0', () => {
      // Fixture Row #3: taxes=61802, has TAX unit
      const units = readUnits(sqlite, buyId2);
      expect(units.find(u => u.type === 'TAX')).toBeDefined();
    });

    it('xact_unit.amount = 61802 (618.02 EUR x 100)', () => {
      const units = readUnits(sqlite, buyId2);
      const tax = units.find(u => u.type === 'TAX')!;
      expect(tax.amount).toBe(61802);
    });

    it('xact_unit.xact = securities-side UUID', () => {
      const units = readUnits(sqlite, buyId2);
      const tax = units.find(u => u.type === 'TAX')!;
      expect(tax.xact).toBe(buyId2);
    });

    it('xact_unit.currency = EUR', () => {
      const units = readUnits(sqlite, buyId2);
      const tax = units.find(u => u.type === 'TAX')!;
      expect(tax.currency).toBe('EUR');
    });

    it('FEE unit coexists alongside TAX', () => {
      // Fixture Row #3 has both FEE (500) and TAX (61802)
      const units = readUnits(sqlite, buyId2);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee).toBeDefined();
      expect(fee.amount).toBe(500);
    });

    it('xact.amount includes both fees and taxes: 3856602', () => {
      // net = (37943 + 5 + 618.02) * 100 = 3856602
      const row = readXact(sqlite, buyId2)!;
      expect(row.amount).toBe(3856602);
    });

    it('xact.fees = 500, xact.taxes = 61802', () => {
      const row = readXact(sqlite, buyId2)!;
      expect(row.fees).toBe(500);
      expect(row.taxes).toBe(61802);
    });
  });

  // ── T1.7 — Integer guarantee ──────────────────────────────────────────────

  describe('T1.7 — integer guarantee', () => {
    it('xact.amount is INTEGER (securities-side)', () => {
      // Without Math.round(), float drift could produce non-integer values
      const row = readXact(sqlite, buyId1)!;
      expect(Number.isInteger(row.amount)).toBe(true);
    });

    it('xact.shares is INTEGER', () => {
      const row = readXact(sqlite, buyId1)!;
      expect(Number.isInteger(row.shares)).toBe(true);
    });

    it('xact.fees is INTEGER', () => {
      const row = readXact(sqlite, buyId1)!;
      expect(Number.isInteger(row.fees)).toBe(true);
    });

    it('xact.taxes is INTEGER', () => {
      const row = readXact(sqlite, buyId1)!;
      expect(Number.isInteger(row.taxes)).toBe(true);
    });

    it('cash-side xact.amount is INTEGER', () => {
      const entries = readCrossEntries(sqlite, buyId1);
      const cashRow = readXact(sqlite, entries[0].to_xact)!;
      expect(Number.isInteger(cashRow.amount)).toBe(true);
    });

    it('all xact_unit.amount values are INTEGER', () => {
      // Tests the toDb() helper which also lacks Math.round()
      const units = readUnits(sqlite, buyId2);
      expect(units.length).toBeGreaterThan(0);
      for (const unit of units) {
        expect(Number.isInteger(unit.amount)).toBe(true);
      }
    });

    it('BUY with taxes: amount, fees, taxes, shares all INTEGER', () => {
      // taxes=618.02 → 61802: exact with Decimal.js but latent risk without Math.round()
      const row = readXact(sqlite, buyId2)!;
      expect(Number.isInteger(row.amount)).toBe(true);
      expect(Number.isInteger(row.fees)).toBe(true);
      expect(Number.isInteger(row.taxes)).toBe(true);
      expect(Number.isInteger(row.shares)).toBe(true);
    });
  });

  // ── T1.8 — Atomicity ─────────────────────────────────────────────────────

  describe('T1.8 — atomicity', () => {
    it('no partial rows when cash-side INSERT fails mid-transaction', () => {
      // Verifies sqlite.transaction() rollback: if the cash-side row fails,
      // the securities-side row must also be rolled back (all-or-nothing).
      const atomPath = uniqueDbPath('atom-buy');
      const atomDb = createTestDb(atomPath);

      // Trigger that fails on the cash-side INSERT (shares=0, type=BUY)
      atomDb.exec(`
        CREATE TRIGGER fail_on_cash_side BEFORE INSERT ON xact
        WHEN NEW.shares = 0 AND NEW.type = 'BUY'
        BEGIN
          SELECT RAISE(ABORT, 'simulated failure for atomicity test');
        END;
      `);

      const xactBefore = (atomDb.prepare('SELECT COUNT(*) AS c FROM xact').get() as { c: number }).c;

      expect(() => {
        createTransaction(null, atomDb, {
          type: TransactionType.BUY,
          date: '2024-01-15',
          amount: 788.16,
          shares: 24,
          securityId: SECURITY_A,
          accountId: PORTFOLIO_UUID,
          currencyCode: 'EUR',
          fees: 5,
        });
      }).toThrow();

      // No partial rows in any table
      expect((atomDb.prepare('SELECT COUNT(*) AS c FROM xact').get() as { c: number }).c).toBe(xactBefore);
      expect((atomDb.prepare('SELECT COUNT(*) AS c FROM xact_cross_entry').get() as { c: number }).c).toBe(0);
      expect((atomDb.prepare('SELECT COUNT(*) AS c FROM xact_unit').get() as { c: number }).c).toBe(0);

      cleanupDb(atomDb, atomPath);
    });
  });
});

// =============================================================================
// TEST GROUP: SELL write
// =============================================================================

describe.skipIf(!hasSqliteBindings)('SELL write parity', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let sellId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('sell');
    sqlite = createTestDb(dbPath);

    // SELL fixture: amount=79242, fees=151, taxes=203, shares=2400000000
    // Reverse: gross = (79242 + 151 + 203) / 100 = 795.96
    sellId = createTransaction(null, sqlite, {
      type: TransactionType.SELL,
      date: '2024-02-01',
      amount: 795.96,
      shares: 24,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 1.51,
      taxes: 2.03,
      note: 'Vendita VanEck ESPO',
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  // ── T2.1 — SELL securities-side xact row ───────────────────────────────────

  describe('T2.1 — xact securities-side row', () => {
    it('xact.type = SELL', () => {
      // SELL is not remapped (not in TYPE_MAP_TO_PPXML2DB)
      const row = readXact(sqlite, sellId)!;
      expect(row.type).toBe('SELL');
    });

    it('xact.account = portfolio UUID', () => {
      const row = readXact(sqlite, sellId)!;
      expect(row.account).toBe(PORTFOLIO_UUID);
    });

    it('xact.acctype = portfolio', () => {
      const row = readXact(sqlite, sellId)!;
      expect(row.acctype).toBe('portfolio');
    });

    it('xact.security = security UUID', () => {
      const row = readXact(sqlite, sellId)!;
      expect(row.security).toBe(SECURITY_A);
    });

    it('xact.amount = 79242 (SELL net = gross - fees - taxes)', () => {
      // SELL inflow: (795.96 - 1.51 - 2.03) * 100 = 79242
      const row = readXact(sqlite, sellId)!;
      expect(row.amount).toBe(79242);
    });

    it('xact.shares = 2400000000 (positive even for SELL)', () => {
      // ppxml2db stores SELL shares as positive; sign is implicit in the type
      const row = readXact(sqlite, sellId)!;
      expect(row.shares).toBe(2400000000);
    });

    it('xact.fees = 151 (1.51 EUR x 100)', () => {
      const row = readXact(sqlite, sellId)!;
      expect(row.fees).toBe(151);
    });

    it('xact.taxes = 203 (2.03 EUR x 100)', () => {
      const row = readXact(sqlite, sellId)!;
      expect(row.taxes).toBe(203);
    });

    it('xact.currency = EUR', () => {
      const row = readXact(sqlite, sellId)!;
      expect(row.currency).toBe('EUR');
    });

    it('xact.note = input note', () => {
      const row = readXact(sqlite, sellId)!;
      expect(row.note).toBe('Vendita VanEck ESPO');
    });
  });

  // ── T2.2 — SELL cash-side xact row ────────────────────────────────────────

  describe('T2.2 — xact cash-side row', () => {
    let cashRow!: XactRow;

    beforeAll(() => {
      const entries = readCrossEntries(sqlite, sellId);
      expect(entries).toHaveLength(1);
      const row = readXact(sqlite, entries[0].to_xact);
      expect(row).toBeDefined();
      cashRow = row!;
    });

    it('xact.type = SELL (same as securities-side)', () => {
      expect(cashRow.type).toBe('SELL');
    });

    it('xact.account = deposit UUID', () => {
      expect(cashRow.account).toBe(DEPOSIT_UUID);
    });

    it('xact.acctype = account', () => {
      expect(cashRow.acctype).toBe('account');
    });

    it('xact.security = security UUID (D4: ppxml2db stores security on both rows)', () => {
      // SELL fixture Row #1 (cash-side): security = "04db1b60-..." (non-null)
      expect(cashRow.security).toBe(SECURITY_A);
    });

    it('xact.shares = 0', () => {
      expect(cashRow.shares).toBe(0);
    });

    it('xact.amount = 79242 (identical to securities-side)', () => {
      expect(cashRow.amount).toBe(79242);
    });

    it('xact.fees = 0', () => {
      expect(cashRow.fees).toBe(0);
    });

    it('xact.taxes = 0', () => {
      expect(cashRow.taxes).toBe(0);
    });

    it('xact.date = same as securities-side', () => {
      expect(cashRow.date).toBe('2024-02-01');
    });

    it('xact.note = same as securities-side', () => {
      expect(cashRow.note).toBe('Vendita VanEck ESPO');
    });
  });

  // ── T2.3 — SELL xact_cross_entry ──────────────────────────────────────────

  describe('T2.3 — xact_cross_entry', () => {
    it('xact_cross_entry.from_xact = securities-side UUID', () => {
      const entries = readCrossEntries(sqlite, sellId);
      expect(entries[0].from_xact).toBe(sellId);
    });

    it('xact_cross_entry.to_xact != from_xact', () => {
      const entries = readCrossEntries(sqlite, sellId);
      expect(entries[0].to_xact).not.toBe(entries[0].from_xact);
    });

    it('from_acc = portfolio, to_acc = deposit (same direction as BUY)', () => {
      // SELL cross_entry direction matches BUY per ppxml2db convention
      const entries = readCrossEntries(sqlite, sellId);
      expect(entries[0].from_acc).toBe(PORTFOLIO_UUID);
      expect(entries[0].to_acc).toBe(DEPOSIT_UUID);
    });

    it('xact_cross_entry.type = buysell', () => {
      const entries = readCrossEntries(sqlite, sellId);
      expect(entries[0].type).toBe('buysell');
    });
  });

  // ── T2.4 — SELL xact_unit GROSS_VALUE ─────────────────────────────────────

  describe('T2.4 — xact_unit GROSS_VALUE', () => {
    it('NO GROSS_VALUE unit for SELL', () => {
      const units = readUnits(sqlite, sellId);
      expect(units.find(u => u.type === 'GROSS_VALUE')).toBeUndefined();
    });
  });

  // ── T2.5 — SELL xact_unit FEE ─────────────────────────────────────────────

  describe('T2.5 — xact_unit FEE', () => {
    it('FEE unit exists with amount = 151', () => {
      // Fixture SELL Row #2: FEE amount=151
      const units = readUnits(sqlite, sellId);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee).toBeDefined();
      expect(fee.amount).toBe(151);
    });

    it('xact_unit.xact = securities-side UUID', () => {
      const units = readUnits(sqlite, sellId);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee.xact).toBe(sellId);
    });

    it('xact_unit.currency = EUR, no forex', () => {
      const units = readUnits(sqlite, sellId);
      const fee = units.find(u => u.type === 'FEE')!;
      expect(fee.currency).toBe('EUR');
      expect(fee.forex_amount).toBeNull();
      expect(fee.forex_currency).toBeNull();
      expect(fee.exchangeRate).toBeNull();
    });
  });

  // ── T2.6 — SELL xact_unit TAX ─────────────────────────────────────────────

  describe('T2.6 — xact_unit TAX', () => {
    it('TAX unit exists with amount = 203', () => {
      // Fixture SELL Row #2: TAX amount=203
      const units = readUnits(sqlite, sellId);
      const tax = units.find(u => u.type === 'TAX')!;
      expect(tax).toBeDefined();
      expect(tax.amount).toBe(203);
    });

    it('xact_unit.xact = securities-side UUID', () => {
      const units = readUnits(sqlite, sellId);
      const tax = units.find(u => u.type === 'TAX')!;
      expect(tax.xact).toBe(sellId);
    });

    it('xact_unit.currency = EUR', () => {
      const units = readUnits(sqlite, sellId);
      const tax = units.find(u => u.type === 'TAX')!;
      expect(tax.currency).toBe('EUR');
    });

    it('no xact_unit rows on cash-side', () => {
      // Fixture SELL Row #1 (cash-side): _xact_unit = []
      const entries = readCrossEntries(sqlite, sellId);
      const cashUnits = readUnits(sqlite, entries[0].to_xact);
      expect(cashUnits).toHaveLength(0);
    });
  });

  // ── T2.7 — SELL integer guarantee ─────────────────────────────────────────

  describe('T2.7 — integer guarantee', () => {
    it('all numeric columns are INTEGER', () => {
      const row = readXact(sqlite, sellId)!;
      expect(Number.isInteger(row.amount)).toBe(true);
      expect(Number.isInteger(row.shares)).toBe(true);
      expect(Number.isInteger(row.fees)).toBe(true);
      expect(Number.isInteger(row.taxes)).toBe(true);

      const entries = readCrossEntries(sqlite, sellId);
      const cashRow = readXact(sqlite, entries[0].to_xact)!;
      expect(Number.isInteger(cashRow.amount)).toBe(true);

      const units = readUnits(sqlite, sellId);
      for (const unit of units) {
        expect(Number.isInteger(unit.amount)).toBe(true);
      }
    });
  });

  // ── T2.8 — SELL atomicity ─────────────────────────────────────────────────

  describe('T2.8 — atomicity', () => {
    it('no partial rows on SELL cash-side INSERT failure', () => {
      const atomPath = uniqueDbPath('atom-sell');
      const atomDb = createTestDb(atomPath);

      atomDb.exec(`
        CREATE TRIGGER fail_on_sell_cash BEFORE INSERT ON xact
        WHEN NEW.shares = 0 AND NEW.type = 'SELL'
        BEGIN
          SELECT RAISE(ABORT, 'simulated SELL failure');
        END;
      `);

      expect(() => {
        createTransaction(null, atomDb, {
          type: TransactionType.SELL,
          date: '2024-02-01',
          amount: 795.96,
          shares: 24,
          securityId: SECURITY_A,
          accountId: PORTFOLIO_UUID,
          currencyCode: 'EUR',
          fees: 1.51,
          taxes: 2.03,
        });
      }).toThrow();

      expect((atomDb.prepare('SELECT COUNT(*) AS c FROM xact').get() as { c: number }).c).toBe(0);
      expect((atomDb.prepare('SELECT COUNT(*) AS c FROM xact_cross_entry').get() as { c: number }).c).toBe(0);
      expect((atomDb.prepare('SELECT COUNT(*) AS c FROM xact_unit').get() as { c: number }).c).toBe(0);

      cleanupDb(atomDb, atomPath);
    });
  });
});

// =============================================================================
// TEST GROUP: UPDATE existing BUY
// =============================================================================

describe.skipIf(!hasSqliteBindings)('UPDATE existing BUY', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('update');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  // ── T3.1 — Update BUY: both rows updated, cross entry correct ────────────

  it('T3.1 — xact: both rows and cross_entry correct after updateTransaction', () => {
    // Create initial BUY
    const buyId = createTransaction(null, sqlite, {
      type: TransactionType.BUY,
      date: '2024-01-15',
      amount: 788.16,
      shares: 24,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 5,
      taxes: 0,
      note: 'original note',
    });

    // Update with new date and note (same financial values)
    updateTransaction(null, sqlite, buyId, {
      type: TransactionType.BUY,
      date: '2024-01-20',
      amount: 788.16,
      shares: 24,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 5,
      taxes: 0,
      note: 'updated note',
    });

    // Securities-side row: same UUID, updated columns
    const secRow = readXact(sqlite, buyId)!;
    expect(secRow.note).toBe('updated note');
    expect(secRow.date).toBe('2024-01-20');
    expect(secRow.amount).toBe(79316);
    expect(secRow.shares).toBe(2400000000);

    // Cross entry: from_acc and to_acc still point to correct accounts
    const entries = readCrossEntries(sqlite, buyId);
    expect(entries).toHaveLength(1);
    expect(entries[0].from_xact).toBe(buyId);
    expect(entries[0].from_acc).toBe(PORTFOLIO_UUID);
    expect(entries[0].to_acc).toBe(DEPOSIT_UUID);

    // Cash-side row: recreated with updated values
    const cashRow = readXact(sqlite, entries[0].to_xact)!;
    expect(cashRow).toBeDefined();
    expect(cashRow.note).toBe('updated note');
    expect(cashRow.date).toBe('2024-01-20');
    expect(cashRow.amount).toBe(79316);
    expect(cashRow.account).toBe(DEPOSIT_UUID);
    expect(cashRow.fees).toBe(0);
    expect(cashRow.taxes).toBe(0);
  });

  // ── T3.2 — Changing amount: all tables reflect new value ──────────────────

  it('T3.2 — xact + xact_unit + xact_cross_entry: all reflect new amount after update', () => {
    const buyId = createTransaction(null, sqlite, {
      type: TransactionType.BUY,
      date: '2024-03-01',
      amount: 500,
      shares: 10,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 2.5,
      taxes: 1.25,
    });

    // Original: net = (500 + 2.5 + 1.25) * 100 = 50375
    expect(readXact(sqlite, buyId)!.amount).toBe(50375);

    // Update with doubled values
    updateTransaction(null, sqlite, buyId, {
      type: TransactionType.BUY,
      date: '2024-03-01',
      amount: 1000,
      shares: 20,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 10,
      taxes: 5,
    });

    // Securities-side: net = (1000 + 10 + 5) * 100 = 101500
    const secRow = readXact(sqlite, buyId)!;
    expect(secRow.amount).toBe(101500);
    expect(secRow.shares).toBe(2000000000); // 20 * 10^8
    expect(secRow.fees).toBe(1000);
    expect(secRow.taxes).toBe(500);

    // Cash-side: same net amount
    const entries = readCrossEntries(sqlite, buyId);
    const cashRow = readXact(sqlite, entries[0].to_xact)!;
    expect(cashRow.amount).toBe(101500);

    // xact_units: updated FEE and TAX
    const units = readUnits(sqlite, buyId);
    const fee = units.find(u => u.type === 'FEE')!;
    expect(fee).toBeDefined();
    expect(fee.amount).toBe(1000);
    const tax = units.find(u => u.type === 'TAX')!;
    expect(tax).toBeDefined();
    expect(tax.amount).toBe(500);
  });
});

// =============================================================================
// TEST GROUP: DELETE BUY
// =============================================================================

describe.skipIf(!hasSqliteBindings)('DELETE BUY', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('delete');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  // ── T4.1 — deleteTransaction removes all related rows ────────────────────

  it('T4.1 — xact + xact_cross_entry + xact_unit: all rows deleted for both sides', () => {
    const buyId = createTransaction(null, sqlite, {
      type: TransactionType.BUY,
      date: '2024-04-01',
      amount: 788.16,
      shares: 24,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 5,
      taxes: 3,
    });

    // Capture cash-side UUID before deletion
    const entries = readCrossEntries(sqlite, buyId);
    const cashUuid = entries[0].to_xact;

    // Verify everything exists pre-delete
    expect(readXact(sqlite, buyId)).toBeDefined();
    expect(readXact(sqlite, cashUuid)).toBeDefined();
    expect(entries).toHaveLength(1);
    expect(readUnits(sqlite, buyId).length).toBeGreaterThan(0);

    // Delete
    deleteTransaction(null, sqlite, buyId);

    // Securities-side xact row: gone
    expect(readXact(sqlite, buyId)).toBeUndefined();
    // Cash-side xact row: gone
    expect(readXact(sqlite, cashUuid)).toBeUndefined();
    // Cross entry: gone
    expect(readCrossEntries(sqlite, buyId)).toHaveLength(0);
    // xact_unit for securities-side: gone
    expect(readUnits(sqlite, buyId)).toHaveLength(0);
    // xact_unit for cash-side: gone
    expect(readUnits(sqlite, cashUuid)).toHaveLength(0);
  });

  // ── T4.2 — No orphaned rows ──────────────────────────────────────────────

  it('T4.2 — no orphaned rows remain in any table after delete', () => {
    // Create and immediately delete
    const buyId = createTransaction(null, sqlite, {
      type: TransactionType.BUY,
      date: '2024-04-02',
      amount: 1000,
      shares: 50,
      securityId: SECURITY_B,
      accountId: PORTFOLIO_UUID,
      currencyCode: 'EUR',
      fees: 10,
      taxes: 20,
    });

    deleteTransaction(null, sqlite, buyId);

    // All tables should be empty (T4.1 already deleted its rows above)
    expect(readAllXact(sqlite)).toHaveLength(0);
    expect(readAllCrossEntries(sqlite)).toHaveLength(0);
    expect(readAllUnits(sqlite)).toHaveLength(0);
  });
});
