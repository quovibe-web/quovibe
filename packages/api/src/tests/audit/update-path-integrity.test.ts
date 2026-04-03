/**
 * Update Path Integrity Tests
 *
 * Comprehensive regression tests for updateTransaction covering all transaction
 * type categories (BUY/SELL, cash-only, delivery, transfer) with full column-level
 * read-back assertions using raw SQL.
 *
 * Investigation summary (2026-03-27):
 *   Q1 — xact_unit lifecycle: DELETE all + INSERT new (via deleteTransactionDeps + insertTransactionDeps)
 *   Q2 — Cash-side on update: old cash-side row deleted, new one created with new UUID
 *   Q3 — Cross entry: deleted and recreated (same from_xact, new to_xact UUID)
 *   Q4 — Account change: fully handled (new referenceAccount resolved)
 *   Q5 — Security change: both rows updated (D4 fix: cash-side carries security UUID)
 *   Q6 — Type change: no validation guard; handled correctly via delete-then-reinsert
 *   Q7 — Atomicity: entire updateTransaction wrapped in sqlite.transaction()
 *   Q8 — Group B/C/D: all correctly handled by delete-then-reinsert pattern
 *   BUGS FOUND: 0
 *
 * Ground truth: docs/audit/sign-convention-registry.md, docs/audit/fixtures/
 * Pattern: same as buy-sell-write-parity.test.ts (raw SQL read-back, column-level assertions)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { readFileSync } from 'fs';
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

// ─── Test UUIDs ────────────────────────────────────────────────────────────────

const PORTFOLIO_UUID = '5ebdc254-bdd9-4ad9-8a57-a2f860089bfa';
const DEPOSIT_UUID = '74011cf8-c166-4d2c-ac4c-af5e57017213';
const DEPOSIT2_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
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
    (2, '${DEPOSIT_UUID}', 'Test Deposit', 'account', 'EUR', 0, NULL, '', 2, 2),
    (3, '${DEPOSIT2_UUID}', 'Test Deposit 2', 'account', 'EUR', 0, NULL, '', 3, 3);
  INSERT INTO security (_id, uuid, name, isin, currency, updatedAt)
  VALUES
    (1, '${SECURITY_A}', 'VanEck ESPO', 'IE00BFYN8Y92', 'EUR', ''),
    (2, '${SECURITY_B}', 'iShares MSCI World', 'IE00B4L5Y983', 'EUR', '');
`;

// ─── Raw DB row types ──────────────────────────────────────────────────────────

interface XactRow {
  uuid: string;
  type: string;
  date: string;
  currency: string;
  amount: number;
  shares: number;
  fees: number;
  taxes: number;
  security: string | null;
  account: string;
  acctype: string;
  note: string | null;
}

interface UnitRow {
  xact: string;
  type: string;
  amount: number;
  currency: string | null;
}

interface CrossEntryRow {
  from_xact: string | null;
  from_acc: string | null;
  to_xact: string;
  to_acc: string;
  type: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getSecuritiesSideRow(sqlite: InstanceType<typeof Database>, id: string): XactRow {
  return sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(id) as XactRow;
}

function getCashSideRow(sqlite: InstanceType<typeof Database>, id: string): XactRow | undefined {
  const cross = sqlite.prepare(
    'SELECT to_xact FROM xact_cross_entry WHERE from_xact = ? AND to_xact != ?'
  ).get(id, id) as { to_xact: string } | undefined;
  if (!cross) return undefined;
  return sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(cross.to_xact) as XactRow | undefined;
}

function getCrossEntry(sqlite: InstanceType<typeof Database>, id: string): CrossEntryRow | undefined {
  return sqlite.prepare(
    'SELECT * FROM xact_cross_entry WHERE from_xact = ?'
  ).get(id) as CrossEntryRow | undefined;
}

function getUnits(sqlite: InstanceType<typeof Database>, id: string): UnitRow[] {
  return sqlite.prepare('SELECT * FROM xact_unit WHERE xact = ?').all(id) as UnitRow[];
}

function getUnitByType(sqlite: InstanceType<typeof Database>, id: string, unitType: string): UnitRow | undefined {
  return sqlite.prepare('SELECT * FROM xact_unit WHERE xact = ? AND type = ?').get(id, unitType) as UnitRow | undefined;
}

// ─── Test suite ────────────────────────────────────────────────────────────────

const descFn = hasSqliteBindings ? describe : describe.skip;

descFn('Update Path Integrity', () => {
  const dbPath = join(tmpdir(), `update-path-integrity-${Date.now()}.db`);
  let sqlite: InstanceType<typeof Database>;

  beforeAll(() => {
    sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(CREATE_TABLES_SQL);
    sqlite.exec(SEED_SQL);
  });

  afterAll(() => {
    sqlite?.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  // Clean xact/unit/cross_entry between tests
  beforeEach(() => {
    sqlite.exec('DELETE FROM xact_unit');
    sqlite.exec('DELETE FROM xact_cross_entry');
    sqlite.exec('DELETE FROM xact');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP A — BUY amount change (U1.1, U1.2, U1.3)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP A — BUY amount change', () => {
    it('U1.1: BUY amount update — securities-side and cash-side columns', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1500,
        shares: 10,
        fees: 5.50,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 2000,
        shares: 10,
        fees: 5.50,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Securities-side row
      const secRow = getSecuritiesSideRow(sqlite, id);
      // BUY outflow: net = gross + fees + taxes = 2000 + 5.50 + 2.00 = 2007.50 → 200750 hecto
      expect(secRow.amount).toBe(200750);
      expect(secRow.shares).toBe(1000000000); // 10 × 10^8
      expect(secRow.fees).toBe(550); // 5.50 × 100
      expect(secRow.taxes).toBe(200); // 2.00 × 100
      expect(secRow.security).toBe(SECURITY_A);
      expect(secRow.account).toBe(PORTFOLIO_UUID);
      expect(secRow.type).toBe('BUY');

      // Cash-side row
      const cashRow = getCashSideRow(sqlite, id);
      expect(cashRow).toBeDefined();
      expect(cashRow!.amount).toBe(200750); // same net amount as securities-side
      expect(cashRow!.security).toBe(SECURITY_A); // D4 fix: NOT NULL
      expect(cashRow!.shares).toBe(0); // cash-side always 0
      expect(cashRow!.fees).toBe(0); // cash-side fees/taxes always 0
      expect(cashRow!.taxes).toBe(0);
      expect(cashRow!.account).toBe(DEPOSIT_UUID); // referenceAccount
    });

    it('U1.2: BUY amount update — xact_cross_entry accounts preserved', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1500,
        shares: 10,
        fees: 5.50,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 2000,
        shares: 10,
        fees: 5.50,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const cross = getCrossEntry(sqlite, id);
      expect(cross).toBeDefined();
      expect(cross!.from_xact).toBe(id);
      expect(cross!.from_acc).toBe(PORTFOLIO_UUID);
      expect(cross!.to_acc).toBe(DEPOSIT_UUID);
      expect(cross!.type).toBe('buysell');
      // to_xact is a new UUID (cash-side regenerated) — just verify it exists
      const cashRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(cross!.to_xact);
      expect(cashRow).toBeDefined();
    });

    it('U1.3: BUY amount update — xact_unit FEE and TAX values updated', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1500,
        shares: 10,
        fees: 5.50,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Verify initial units
      const feeUnitBefore = getUnitByType(sqlite, id, 'FEE');
      expect(feeUnitBefore).toBeDefined();
      expect(feeUnitBefore!.amount).toBe(550); // 5.50 × 100 hecto

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 2000,
        shares: 10,
        fees: 8.25,
        taxes: 3.50,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const feeUnit = getUnitByType(sqlite, id, 'FEE');
      expect(feeUnit).toBeDefined();
      expect(feeUnit!.amount).toBe(825); // 8.25 × 100 hecto

      const taxUnit = getUnitByType(sqlite, id, 'TAX');
      expect(taxUnit).toBeDefined();
      expect(taxUnit!.amount).toBe(350); // 3.50 × 100 hecto
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP B — BUY fees change / orphan test (U2.1, U2.2, U2.3)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP B — BUY fees change (orphan test)', () => {
    it('U2.1: BUY fees=5.50 → fees=0 — FEE xact_unit row MUST be deleted', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 5.50,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Verify FEE unit exists with correct value
      const feeBefore = getUnitByType(sqlite, id, 'FEE');
      expect(feeBefore).toBeDefined();
      expect(feeBefore!.amount).toBe(550);

      // Update to fees=0
      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // NO FEE row must exist
      const feeAfter = getUnitByType(sqlite, id, 'FEE');
      expect(feeAfter).toBeUndefined();

      // No units at all for this xact
      const allUnits = getUnits(sqlite, id);
      expect(allUnits.length).toBe(0);
    });

    it('U2.2: BUY fees=0 → fees=7.25 — FEE xact_unit row MUST be created', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // No FEE unit initially
      const feeBefore = getUnitByType(sqlite, id, 'FEE');
      expect(feeBefore).toBeUndefined();

      // Update to fees=7.25
      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 7.25,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const feeAfter = getUnitByType(sqlite, id, 'FEE');
      expect(feeAfter).toBeDefined();
      expect(feeAfter!.amount).toBe(725); // 7.25 × 100 hecto
    });

    it('U2.3: BUY fees=5.50 + taxes=2.00 → fees=0 + taxes=0 — ZERO FEE and TAX rows', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 5.50,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Both exist before
      expect(getUnitByType(sqlite, id, 'FEE')).toBeDefined();
      expect(getUnitByType(sqlite, id, 'TAX')).toBeDefined();

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const allUnits = getUnits(sqlite, id);
      expect(allUnits.filter(u => u.type === 'FEE').length).toBe(0);
      expect(allUnits.filter(u => u.type === 'TAX').length).toBe(0);
      expect(allUnits.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP C — BUY security change (U3.1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP C — BUY security change', () => {
    it('U3.1: BUY security=A → security=B — securities-side and cash-side updated', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Verify initial security
      expect(getSecuritiesSideRow(sqlite, id).security).toBe(SECURITY_A);

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_B,
      });

      // Securities-side: security = SEC_B
      const secRow = getSecuritiesSideRow(sqlite, id);
      expect(secRow.security).toBe(SECURITY_B);

      // Cash-side: security = SEC_B (D4 fix — ppxml2db stores security on both rows)
      const cashRow = getCashSideRow(sqlite, id);
      expect(cashRow).toBeDefined();
      expect(cashRow!.security).toBe(SECURITY_B);
      expect(cashRow!.shares).toBe(0); // cash-side shares always 0
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP D — BUY shares change (U4.1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP D — BUY shares change', () => {
    it('U4.1: BUY shares=10 → shares=25 — raw DB ×10^8', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 25,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const secRow = getSecuritiesSideRow(sqlite, id);
      expect(secRow.shares).toBe(2500000000); // 25 × 10^8

      const cashRow = getCashSideRow(sqlite, id);
      expect(cashRow).toBeDefined();
      expect(cashRow!.shares).toBe(0); // cash-side always 0
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP E — SELL update with sign convention (U5.1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP E — SELL update (sign convention)', () => {
    it('U5.1: SELL amount=1200→1800, shares=5→8 — sign convention verified', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.SELL,
        date: '2024-03-01',
        amount: 1200,
        shares: 5,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.SELL,
        date: '2024-03-01',
        amount: 1800,
        shares: 8,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Securities-side: per sign-convention-registry, ALL values positive
      const secRow = getSecuritiesSideRow(sqlite, id);
      // SELL inflow: net = gross - fees - taxes = 1800 - 0 - 0 = 1800 → 180000 hecto
      expect(secRow.amount).toBe(180000);
      expect(secRow.amount).toBeGreaterThan(0); // sign convention: positive
      expect(secRow.shares).toBe(800000000); // 8 × 10^8
      expect(secRow.shares).toBeGreaterThan(0); // sign convention: positive
      expect(secRow.type).toBe('SELL');
      expect(secRow.security).toBe(SECURITY_A);

      // Cash-side: same amount, shares=0
      const cashRow = getCashSideRow(sqlite, id);
      expect(cashRow).toBeDefined();
      expect(cashRow!.amount).toBe(180000); // same net
      expect(cashRow!.amount).toBeGreaterThan(0); // sign convention: positive
      expect(cashRow!.shares).toBe(0);
      expect(cashRow!.type).toBe('SELL');
      expect(cashRow!.security).toBe(SECURITY_A); // D4 fix
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP F — Cash-only type update (U6.1, U6.2)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP F — Cash-only type update', () => {
    it('U6.1: DEPOSIT amount=500 → amount=750 — single row, no cross entry', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2024-02-01',
        amount: 500,
        accountId: DEPOSIT_UUID,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.DEPOSIT,
        date: '2024-02-01',
        amount: 750,
        accountId: DEPOSIT_UUID,
      });

      const row = getSecuritiesSideRow(sqlite, id);
      expect(row.amount).toBe(75000); // 750 × 100 hecto
      expect(row.type).toBe('DEPOSIT');
      expect(row.account).toBe(DEPOSIT_UUID);

      // No xact_cross_entry
      const cross = getCrossEntry(sqlite, id);
      expect(cross).toBeUndefined();

      // No orphaned xact_unit
      const units = getUnits(sqlite, id);
      expect(units.length).toBe(0);

      // Only 1 xact row total
      const cnt = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt;
      expect(cnt).toBe(1);
    });

    it('U6.2: DIVIDEND with fees=3.00 → fees=0 — FEE unit removed, xact.fees=0', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DIVIDEND,
        date: '2024-06-15',
        amount: 100,
        shares: 50,
        fees: 3.00,
        taxes: 0,
        accountId: DEPOSIT_UUID,
        securityId: SECURITY_A,
      });

      // FEE unit exists before
      expect(getUnitByType(sqlite, id, 'FEE')).toBeDefined();
      expect(getUnitByType(sqlite, id, 'FEE')!.amount).toBe(300); // 3.00 × 100

      updateTransaction(null, sqlite, id, {
        type: TransactionType.DIVIDEND,
        date: '2024-06-15',
        amount: 100,
        shares: 50,
        fees: 0,
        taxes: 0,
        accountId: DEPOSIT_UUID,
        securityId: SECURITY_A,
      });

      // FEE unit gone
      expect(getUnitByType(sqlite, id, 'FEE')).toBeUndefined();

      // xact.fees denormalized column = 0
      const row = getSecuritiesSideRow(sqlite, id);
      expect(row.fees).toBe(0);
      expect(row.taxes).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP G — Delivery type update (U7.1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP G — Delivery type update', () => {
    it('U7.1: DELIVERY_INBOUND shares=100 → shares=200 — single row, no cross entry', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DELIVERY_INBOUND,
        date: '2024-04-01',
        amount: 0,
        shares: 100,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.DELIVERY_INBOUND,
        date: '2024-04-01',
        amount: 0,
        shares: 200,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const row = getSecuritiesSideRow(sqlite, id);
      expect(row.shares).toBe(20000000000); // 200 × 10^8
      expect(row.amount).toBe(0); // deliveries have no cash movement
      expect(row.type).toBe('TRANSFER_IN'); // mapped by toDbType

      // No cross entry — delivery is single row
      const cross = getCrossEntry(sqlite, id);
      expect(cross).toBeUndefined();

      // Only 1 xact row total
      const cnt = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt;
      expect(cnt).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP H — Transfer type update (U8.1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP H — Transfer type update', () => {
    it('U8.1: TRANSFER_BETWEEN_ACCOUNTS amount=1000 → 1500 — both rows updated', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        date: '2024-05-01',
        amount: 1000,
        accountId: DEPOSIT_UUID,
        crossAccountId: DEPOSIT2_UUID,
      });

      const crossBefore = getCrossEntry(sqlite, id);
      expect(crossBefore).toBeDefined();

      updateTransaction(null, sqlite, id, {
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        date: '2024-05-01',
        amount: 1500,
        accountId: DEPOSIT_UUID,
        crossAccountId: DEPOSIT2_UUID,
      });

      // Source row
      const srcRow = getSecuritiesSideRow(sqlite, id);
      expect(srcRow.amount).toBe(150000); // 1500 × 100
      expect(srcRow.type).toBe('TRANSFER_OUT');
      expect(srcRow.account).toBe(DEPOSIT_UUID);

      // Dest row
      const crossAfter = getCrossEntry(sqlite, id);
      expect(crossAfter).toBeDefined();
      expect(crossAfter!.from_acc).toBe(DEPOSIT_UUID);
      expect(crossAfter!.to_acc).toBe(DEPOSIT2_UUID);
      expect(crossAfter!.type).toBe('account-transfer');

      const destRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(crossAfter!.to_xact) as XactRow;
      expect(destRow.amount).toBe(150000); // same amount
      expect(destRow.type).toBe('TRANSFER_IN');
      expect(destRow.account).toBe(DEPOSIT2_UUID);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP I — Atomicity on update (U9.1, U9.2)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP I — Atomicity', () => {
    it('U9.1: updateTransaction is wrapped in sqlite.transaction()', () => {
      // Code-review assertion: verified by reading transaction.service.ts
      // Line 437: const doUpdate = sqlite.transaction(() => { ... });
      // Line 556: return doUpdate() as string;
      // The entire update (main xact UPDATE, deleteTransactionDeps, cash-side INSERT,
      // insertTransactionDeps) is inside the transaction callback.
      //
      // Structural verification: read the source and confirm the pattern
      const servicePath = join(__dirname, '..', '..', 'services', 'transaction.service.ts');
      const source = readFileSync(servicePath, 'utf-8');

      // Find updateTransaction function
      const updateFnMatch = source.match(/export function updateTransaction\b[\s\S]*?^}/m);
      expect(updateFnMatch).not.toBeNull();

      // Verify it contains sqlite.transaction()
      const fnBody = updateFnMatch![0];
      expect(fnBody).toContain('sqlite.transaction(');
      expect(fnBody).toContain('deleteTransactionDeps');
      expect(fnBody).toContain('insertTransactionDeps');
    });

    it('U9.2: failed update leaves DB unchanged (rollback)', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 5.00,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Snapshot pre-update state
      const xactsBefore = sqlite.prepare('SELECT * FROM xact ORDER BY uuid').all() as XactRow[];
      const unitsBefore = sqlite.prepare('SELECT * FROM xact_unit ORDER BY xact, type').all() as UnitRow[];
      const crossBefore = sqlite.prepare('SELECT * FROM xact_cross_entry ORDER BY from_xact').all() as CrossEntryRow[];

      // Attempt update with invalid accountId (non-existent) — the account lookup returns
      // undefined, so resolved.effectiveAccountId will be the invalid UUID itself.
      // However, this won't actually throw because the code handles undefined gracefully.
      // Instead, test with a portfolio account that has no referenceAccount set, which
      // should not happen in practice. We can test rollback by temporarily dropping xact_unit table.

      // A more reliable approach: rename xact_unit table to force an INSERT failure
      sqlite.exec('ALTER TABLE xact_unit RENAME TO xact_unit_bak');

      try {
        updateTransaction(null, sqlite, id, {
          type: TransactionType.BUY,
          date: '2024-01-15',
          amount: 2000,
          shares: 20,
          fees: 10.00,
          taxes: 5.00,
          accountId: PORTFOLIO_UUID,
          securityId: SECURITY_A,
        });
        // If it doesn't throw, the test setup didn't work — fail explicitly
        expect.unreachable('updateTransaction should have thrown due to missing xact_unit table');
      } catch {
        // Expected — the INSERT INTO xact_unit should fail
      }

      // Restore table
      sqlite.exec('ALTER TABLE xact_unit_bak RENAME TO xact_unit');

      // Verify DB state is identical to pre-update
      const xactsAfter = sqlite.prepare('SELECT * FROM xact ORDER BY uuid').all() as XactRow[];
      const unitsAfter = sqlite.prepare('SELECT * FROM xact_unit ORDER BY xact, type').all() as UnitRow[];
      const crossAfter = sqlite.prepare('SELECT * FROM xact_cross_entry ORDER BY from_xact').all() as CrossEntryRow[];

      expect(xactsAfter.length).toBe(xactsBefore.length);
      for (let i = 0; i < xactsBefore.length; i++) {
        expect(xactsAfter[i].uuid).toBe(xactsBefore[i].uuid);
        expect(xactsAfter[i].amount).toBe(xactsBefore[i].amount);
        expect(xactsAfter[i].shares).toBe(xactsBefore[i].shares);
      }

      expect(unitsAfter.length).toBe(unitsBefore.length);
      for (let i = 0; i < unitsBefore.length; i++) {
        expect(unitsAfter[i].xact).toBe(unitsBefore[i].xact);
        expect(unitsAfter[i].type).toBe(unitsBefore[i].type);
        expect(unitsAfter[i].amount).toBe(unitsBefore[i].amount);
      }

      expect(crossAfter.length).toBe(crossBefore.length);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP J — Integer guarantee on update (U10.1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP J — Integer guarantee on update', () => {
    it('U10.1: fractional inputs produce integer DB values', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1500.75,
        shares: 10.5,
        fees: 5.50,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Securities-side
      const secRow = getSecuritiesSideRow(sqlite, id);
      // BUY outflow: net = 1500.75 + 5.50 + 0 = 1506.25 → 150625 hecto
      expect(Number.isInteger(secRow.amount)).toBe(true);
      expect(secRow.amount).toBe(150625);
      expect(Number.isInteger(secRow.shares)).toBe(true);
      expect(secRow.shares).toBe(1050000000); // 10.5 × 10^8
      expect(Number.isInteger(secRow.fees)).toBe(true);
      expect(secRow.fees).toBe(550); // 5.50 × 100
      expect(Number.isInteger(secRow.taxes)).toBe(true);
      expect(secRow.taxes).toBe(0);

      // Cash-side
      const cashRow = getCashSideRow(sqlite, id);
      expect(cashRow).toBeDefined();
      expect(Number.isInteger(cashRow!.amount)).toBe(true);
      expect(Number.isInteger(cashRow!.shares)).toBe(true);
      expect(Number.isInteger(cashRow!.fees)).toBe(true);
      expect(Number.isInteger(cashRow!.taxes)).toBe(true);

      // xact_unit
      const feeUnit = getUnitByType(sqlite, id, 'FEE');
      expect(feeUnit).toBeDefined();
      expect(Number.isInteger(feeUnit!.amount)).toBe(true);
      expect(feeUnit!.amount).toBe(550);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP K — Type change guard (U11.1, U11.2)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP K — Type change guard', () => {
    it('U11.1: DEPOSIT → BUY — cash-side row + cross entry created correctly', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2024-01-15',
        amount: 1000,
        accountId: DEPOSIT_UUID,
      });

      // DEPOSIT: single row, no cross entry
      expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt).toBe(1);
      expect(getCrossEntry(sqlite, id)).toBeUndefined();

      // Change to BUY
      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // Now should have 2 xact rows
      expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt).toBe(2);

      // Securities-side
      const secRow = getSecuritiesSideRow(sqlite, id);
      expect(secRow.type).toBe('BUY');
      expect(secRow.account).toBe(PORTFOLIO_UUID);
      expect(secRow.security).toBe(SECURITY_A);

      // Cash-side created
      const cashRow = getCashSideRow(sqlite, id);
      expect(cashRow).toBeDefined();
      expect(cashRow!.account).toBe(DEPOSIT_UUID);
      expect(cashRow!.shares).toBe(0);
      expect(cashRow!.security).toBe(SECURITY_A); // D4 fix

      // Cross entry created
      const cross = getCrossEntry(sqlite, id);
      expect(cross).toBeDefined();
      expect(cross!.from_acc).toBe(PORTFOLIO_UUID);
      expect(cross!.to_acc).toBe(DEPOSIT_UUID);
      expect(cross!.type).toBe('buysell');
    });

    it('U11.2: BUY → DEPOSIT — old cash-side row + cross entry cleaned up', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 5.00,
        taxes: 2.00,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      // BUY: 2 rows, cross entry, units
      expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt).toBe(2);
      const crossBefore = getCrossEntry(sqlite, id);
      expect(crossBefore).toBeDefined();
      const oldCashUuid = crossBefore!.to_xact;
      expect(getUnits(sqlite, id).length).toBeGreaterThan(0);

      // Change to DEPOSIT
      updateTransaction(null, sqlite, id, {
        type: TransactionType.DEPOSIT,
        date: '2024-01-15',
        amount: 1000,
        accountId: DEPOSIT_UUID,
      });

      // Now should have 1 xact row only
      expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt).toBe(1);

      // Old cash-side row is gone
      const oldCashRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(oldCashUuid);
      expect(oldCashRow).toBeUndefined();

      // No cross entry
      expect(getCrossEntry(sqlite, id)).toBeUndefined();

      // No orphaned units
      const orphanedUnits = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM xact_unit WHERE xact NOT IN (SELECT uuid FROM xact)'
      ).get() as { cnt: number };
      expect(orphanedUnits.cnt).toBe(0);

      // Main row is now DEPOSIT
      const row = getSecuritiesSideRow(sqlite, id);
      expect(row.type).toBe('DEPOSIT');
      expect(row.account).toBe(DEPOSIT_UUID);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LEGACY GROUPS (preserved from original file, additional coverage)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LEGACY A — xact_unit cleanup: additional cases', () => {
    it('A3: DIVIDEND with taxes=10 updated to taxes=0 → TAX unit removed', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DIVIDEND,
        date: '2024-06-15',
        amount: 50,
        shares: 100,
        fees: 0,
        taxes: 10,
        accountId: DEPOSIT_UUID,
        securityId: SECURITY_A,
      });

      const unitsBefore = getUnits(sqlite, id);
      expect(unitsBefore.some(u => u.type === 'TAX')).toBe(true);

      updateTransaction(null, sqlite, id, {
        type: TransactionType.DIVIDEND,
        date: '2024-06-15',
        amount: 50,
        shares: 100,
        fees: 0,
        taxes: 0,
        accountId: DEPOSIT_UUID,
        securityId: SECURITY_A,
      });

      const unitsAfter = getUnits(sqlite, id);
      expect(unitsAfter.some(u => u.type === 'TAX')).toBe(false);
    });

    it('A4: No orphaned xact_unit rows after BUY update with fees+taxes zeroed', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 10,
        taxes: 5,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 2000,
        shares: 20,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const orphans = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM xact_unit WHERE xact NOT IN (SELECT uuid FROM xact)'
      ).get() as { cnt: number };
      expect(orphans.cnt).toBe(0);
    });
  });

  describe('LEGACY B — Cash-side lifecycle additional', () => {
    it('B3: exactly 1 cross_entry row after BUY update', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 5,
        taxes: 3,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const entries = sqlite.prepare(
        'SELECT * FROM xact_cross_entry WHERE from_xact = ?'
      ).all(id);
      expect(entries.length).toBe(1);
    });
  });

  describe('LEGACY C — Additional type changes', () => {
    it('C1: DEPOSIT → REMOVAL — type changes, amount updated', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2024-01-15',
        amount: 1000,
        accountId: DEPOSIT_UUID,
      });

      updateTransaction(null, sqlite, id, {
        type: TransactionType.REMOVAL,
        date: '2024-01-15',
        amount: 500,
        accountId: DEPOSIT_UUID,
      });

      const row = getSecuritiesSideRow(sqlite, id);
      expect(row.type).toBe('REMOVAL');
      expect(row.amount).toBe(50000);
      expect(getCrossEntry(sqlite, id)).toBeUndefined();
    });

    it('C4: INTEREST → FEES — type changes, TAX unit removed', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.INTEREST,
        date: '2024-06-15',
        amount: 50,
        fees: 0,
        taxes: 10,
        accountId: DEPOSIT_UUID,
      });

      const unitsBefore = getUnits(sqlite, id);
      expect(unitsBefore.some(u => u.type === 'TAX')).toBe(true);

      updateTransaction(null, sqlite, id, {
        type: TransactionType.FEES,
        date: '2024-06-15',
        amount: 50,
        fees: 0,
        taxes: 0,
        accountId: DEPOSIT_UUID,
      });

      const row = getSecuritiesSideRow(sqlite, id);
      expect(row.type).toBe('FEES');
      const unitsAfter = getUnits(sqlite, id);
      expect(unitsAfter.length).toBe(0);
    });
  });

  describe('LEGACY E — Global integrity', () => {
    it('E1: no orphans after create + update + delete cycle', () => {
      const id1 = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 10,
        taxes: 5,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      const id2 = createTransaction(null, sqlite, {
        type: TransactionType.DEPOSIT,
        date: '2024-02-01',
        amount: 500,
        accountId: DEPOSIT_UUID,
      });

      updateTransaction(null, sqlite, id1, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 2000,
        shares: 20,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      deleteTransaction(null, sqlite, id2);

      const orphanedUnits = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM xact_unit WHERE xact NOT IN (SELECT uuid FROM xact)'
      ).get() as { cnt: number };
      expect(orphanedUnits.cnt).toBe(0);

      const orphanedCross = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM xact_cross_entry WHERE from_xact NOT IN (SELECT uuid FROM xact)'
      ).get() as { cnt: number };
      expect(orphanedCross.cnt).toBe(0);
    });

    it('E2: xact count stays 2 after BUY update', () => {
      const id = createTransaction(null, sqlite, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt).toBe(2);

      updateTransaction(null, sqlite, id, {
        type: TransactionType.BUY,
        date: '2024-01-15',
        amount: 2000,
        shares: 20,
        fees: 0,
        taxes: 0,
        accountId: PORTFOLIO_UUID,
        securityId: SECURITY_A,
      });

      expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM xact').get() as { cnt: number }).cnt).toBe(2);
    });
  });
});
