/**
 * Cash-Types Write-Parity Tests
 *
 * Ground truth: docs/audit/fixtures/xact-cash-types.json
 *
 * Types covered (9): DEPOSIT, REMOVAL, DIVIDEND, INTEREST, INTEREST_CHARGE,
 *                    FEES, FEES_REFUND, TAXES, TAX_REFUND
 *
 * Strategy:
 *   - Call createTransaction with fixture-derived inputs
 *   - Read back raw rows with direct SQL (never through service read layer)
 *   - Compare every column against fixture-derived expected values
 *
 * Divergences found:
 *   D6 (MEDIUM): buildUnits creates spurious FEE xact_unit for FEES/FEES_REFUND
 *   D7 (MEDIUM): buildUnits creates spurious TAX xact_unit for TAXES/TAX_REFUND
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { TransactionType } from '@quovibe/shared';
import { createTransaction } from '../../services/transaction.service';

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
const DEPOSIT_UUID   = '74011cf8-c166-4d2c-ac4c-af5e57017213';
const SECURITY_A     = '6d8b85db-ce35-41fc-96fb-67d176db41fa'; // BTP Valore1
const SECURITY_B     = '99401ac3-2a74-4078-b15d-56c5868db9dd'; // BTP 1FB37
const SECURITY_C     = 'c4a719eb-3c88-4766-8773-fbeb053a1ed9'; // ETF Test

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
    (1, '${SECURITY_A}', 'BTP Valore1', NULL, 'EUR', ''),
    (2, '${SECURITY_B}', 'BTP 1FB37', NULL, 'EUR', ''),
    (3, '${SECURITY_C}', 'ETF Test', NULL, 'EUR', '');
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


function uniqueDbPath(label: string): string {
  return join(tmpdir(), `audit-cash-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

function cleanupDb(db: Database.Database, path: string): void {
  db.close();
  if (existsSync(path)) unlinkSync(path);
}

// =============================================================================
// GROUP A — DEPOSIT
// Fixture: xact-cash-types.json → DEPOSIT rows
//   Row 1: amount=400000 (EUR 4000), fees=0, taxes=0, shares=0, security=null
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP A — DEPOSIT', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let depositId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('deposit');
    sqlite = createTestDb(dbPath);

    // Fixture Row 1: EUR 4000 deposit
    depositId = createTransaction(null, sqlite, {
      type: TransactionType.DEPOSIT,
      date: '2020-09-02T10:14',
      amount: 4000,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      note: undefined,
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  it('A1: writes exactly 1 xact row', () => {
    expect(readAllXact(sqlite)).toHaveLength(1);
  });

  it('A2: xact.type = "DEPOSIT"', () => {
    const row = readXact(sqlite, depositId)!;
    expect(row.type).toBe('DEPOSIT');
  });

  it('A3: xact.account = deposit UUID, acctype = "account"', () => {
    const row = readXact(sqlite, depositId)!;
    expect(row.account).toBe(DEPOSIT_UUID);
    expect(row.acctype).toBe('account');
  });

  it('A4: xact.security = NULL, shares = 0', () => {
    const row = readXact(sqlite, depositId)!;
    expect(row.security).toBeNull();
    expect(row.shares).toBe(0);
  });

  it('A5: xact.amount = 400000, fees = 0, taxes = 0', () => {
    const row = readXact(sqlite, depositId)!;
    expect(row.amount).toBe(400000);
    expect(row.fees).toBe(0);
    expect(row.taxes).toBe(0);
  });

  it('A6: no xact_unit rows', () => {
    expect(readUnits(sqlite, depositId)).toHaveLength(0);
  });
});

// =============================================================================
// GROUP B — REMOVAL
// Fixture: REMOVAL row 1: amount=1451354 (POSITIVE), shares=0, security=null
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP B — REMOVAL', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let removalId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('removal');
    sqlite = createTestDb(dbPath);

    // Fixture Row 1: EUR 14513.54 removal
    removalId = createTransaction(null, sqlite, {
      type: TransactionType.REMOVAL,
      date: '2022-10-18T15:00',
      amount: 14513.54,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  it('B1: writes exactly 1 xact row', () => {
    expect(readAllXact(sqlite)).toHaveLength(1);
  });

  it('B2: xact.type = "REMOVAL"', () => {
    const row = readXact(sqlite, removalId)!;
    expect(row.type).toBe('REMOVAL');
  });

  it('B3: amount is POSITIVE (sign implied by type) — fixture: 1451354', () => {
    const row = readXact(sqlite, removalId)!;
    expect(row.amount).toBe(1451354);
    expect(row.amount).toBeGreaterThan(0);
  });

  it('B4: security = NULL, shares = 0', () => {
    const row = readXact(sqlite, removalId)!;
    expect(row.security).toBeNull();
    expect(row.shares).toBe(0);
  });

  it('B5: no xact_unit rows', () => {
    expect(readUnits(sqlite, removalId)).toHaveLength(0);
  });
});

// =============================================================================
// GROUP C — DIVIDEND
// Fixture: DIVIDENDS row 1: amount=71094, fees=0, taxes=10156, shares=50000000000,
//          security=UUID, type="DIVIDENDS", TAX xact_unit
// Net amount: gross − fees − taxes → (71094 + 0 + 10156) / 100 = 812.50 gross
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP C — DIVIDEND', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let divId1: string; // with taxes
  let divId2: string; // without taxes

  beforeAll(() => {
    dbPath = uniqueDbPath('dividend');
    sqlite = createTestDb(dbPath);

    // Row 1: gross=812.50, fees=0, taxes=101.56 → net=710.94 → 71094
    divId1 = createTransaction(null, sqlite, {
      type: TransactionType.DIVIDEND,
      date: '2023-12-13T10:00',
      amount: 812.50,
      shares: 500, // ex-date shares held → 50000000000 in DB
      securityId: SECURITY_A,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 101.56,
      note: 'ACCREDITO CEDOLA BTP VALORE1',
    });

    // Synthetic: dividend with no taxes
    divId2 = createTransaction(null, sqlite, {
      type: TransactionType.DIVIDEND,
      date: '2024-06-01T10:00',
      amount: 50,
      securityId: SECURITY_B,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 0,
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  it('C1: writes exactly 1 xact row per DIVIDEND call', () => {
    expect(readAllXact(sqlite)).toHaveLength(2);
  });

  it('C2: xact.type = "DIVIDENDS" (ppxml2db plural convention)', () => {
    const row = readXact(sqlite, divId1)!;
    expect(row.type).toBe('DIVIDENDS');
  });

  it('C3: xact.security = input securityId (non-null)', () => {
    const row = readXact(sqlite, divId1)!;
    expect(row.security).toBe(SECURITY_A);
  });

  it('C4: xact.shares = input × 10^8 (ex-date shares held)', () => {
    const row = readXact(sqlite, divId1)!;
    expect(row.shares).toBe(50000000000);
  });

  it('C5: xact.amount = net (gross − fees − taxes) × 100', () => {
    const row = readXact(sqlite, divId1)!;
    // 812.50 - 0 - 101.56 = 710.94 → 71094
    expect(row.amount).toBe(71094);
    expect(row.fees).toBe(0);
    expect(row.taxes).toBe(10156);
  });

  it('C6: TAX xact_unit present when taxes > 0, amount = taxes × 100', () => {
    const units = readUnits(sqlite, divId1);
    const taxUnits = units.filter(u => u.type === 'TAX');
    expect(taxUnits).toHaveLength(1);
    expect(taxUnits[0].amount).toBe(10156);
    expect(taxUnits[0].currency).toBe('EUR');
  });

  it('C7: no xact_unit when taxes = 0 and fees = 0', () => {
    const units = readUnits(sqlite, divId2);
    expect(units).toHaveLength(0);
  });
});

// =============================================================================
// GROUP D — INTEREST + INTEREST_CHARGE
// Fixture INTEREST: amount=3178, taxes=1117, security=null, shares=0, TAX unit
// Fixture INTEREST_CHARGE: amount=6, taxes=0, security=null, shares=0, no units
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP D — INTEREST + INTEREST_CHARGE', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let interestId: string;
  let chargeId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('interest');
    sqlite = createTestDb(dbPath);

    // INTEREST: fixture row 1 — amount=31.78 (net), taxes=11.17
    interestId = createTransaction(null, sqlite, {
      type: TransactionType.INTEREST,
      date: '2023-12-27T07:00',
      amount: 31.78,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 11.17,
      note: 'INTERESSI VINCOLO 10K AL 4,75%',
    });

    // INTEREST_CHARGE: fixture row — amount=0.06
    chargeId = createTransaction(null, sqlite, {
      type: TransactionType.INTEREST_CHARGE,
      date: '2023-11-01T10:00',
      amount: 0.06,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 0,
      note: 'interessi finanziamento per pagamento bollo',
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  it('D1: INTEREST — type = "INTEREST", security = NULL, shares = 0', () => {
    const row = readXact(sqlite, interestId)!;
    expect(row.type).toBe('INTEREST');
    expect(row.security).toBeNull();
    expect(row.shares).toBe(0);
  });

  it('D2: INTEREST — amount = 3178, fees = 0, taxes = 1117', () => {
    const row = readXact(sqlite, interestId)!;
    expect(row.amount).toBe(3178);
    expect(row.fees).toBe(0);
    expect(row.taxes).toBe(1117);
  });

  it('D3: INTEREST — TAX xact_unit present, amount = 1117', () => {
    const units = readUnits(sqlite, interestId);
    const taxUnits = units.filter(u => u.type === 'TAX');
    expect(taxUnits).toHaveLength(1);
    expect(taxUnits[0].amount).toBe(1117);
  });

  it('D4: INTEREST_CHARGE — type = "INTEREST_CHARGE", security = NULL, shares = 0', () => {
    const row = readXact(sqlite, chargeId)!;
    expect(row.type).toBe('INTEREST_CHARGE');
    expect(row.security).toBeNull();
    expect(row.shares).toBe(0);
  });

  it('D5: INTEREST_CHARGE — amount = 6, fees = 0, taxes = 0', () => {
    const row = readXact(sqlite, chargeId)!;
    expect(row.amount).toBe(6);
    expect(row.fees).toBe(0);
    expect(row.taxes).toBe(0);
  });

  it('D6: INTEREST_CHARGE — no xact_unit rows', () => {
    expect(readUnits(sqlite, chargeId)).toHaveLength(0);
  });
});

// =============================================================================
// GROUP E — FEES + FEES_REFUND
// Fixture FEES: amount=150/516, security=null/UUID, NO xact_unit (ppxml2db parity)
// FEES_REFUND: not in fixture, synthetic — same pattern as FEES
//
// DIVERGENCE D6: buildUnits unconditionally creates FEE xact_unit for FEES/FEES_REFUND
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP E — FEES + FEES_REFUND', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let feesId1: string;  // without security
  let feesId2: string;  // with security
  let feesRefundId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('fees');
    sqlite = createTestDb(dbPath);

    // FEES fixture row 1: amount=1.50, security=null
    feesId1 = createTransaction(null, sqlite, {
      type: TransactionType.FEES,
      date: '2024-12-23T10:01',
      amount: 1.50,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 0,
      note: 'COMMISSIONI PER BONIFICO',
    });

    // FEES fixture row 2: amount=5.16, security=SECURITY_C
    feesId2 = createTransaction(null, sqlite, {
      type: TransactionType.FEES,
      date: '2025-09-30T07:02',
      amount: 5.16,
      securityId: SECURITY_C,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 0,
    });

    // FEES_REFUND: synthetic (not in fixture)
    feesRefundId = createTransaction(null, sqlite, {
      type: TransactionType.FEES_REFUND,
      date: '2025-01-15T10:00',
      amount: 2.50,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 0,
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  it('E1: FEES — type = "FEES", amount = 150', () => {
    const row = readXact(sqlite, feesId1)!;
    expect(row.type).toBe('FEES');
    expect(row.amount).toBe(150);
  });

  it('E2: FEES without security — security = NULL, no xact_unit (ppxml2db parity)', () => {
    const row = readXact(sqlite, feesId1)!;
    expect(row.security).toBeNull();
    expect(readUnits(sqlite, feesId1)).toHaveLength(0);
  });

  it('E3: FEES with security — security = UUID, no xact_unit (ppxml2db parity)', () => {
    const row = readXact(sqlite, feesId2)!;
    expect(row.security).toBe(SECURITY_C);
    expect(readUnits(sqlite, feesId2)).toHaveLength(0);
  });

  it('E4: FEES_REFUND — type = "FEES_REFUND", amount = 250', () => {
    const row = readXact(sqlite, feesRefundId)!;
    expect(row.type).toBe('FEES_REFUND');
    expect(row.amount).toBe(250);
  });

  it('E5: FEES_REFUND — no xact_unit (ppxml2db parity)', () => {
    expect(readUnits(sqlite, feesRefundId)).toHaveLength(0);
  });
});

// =============================================================================
// GROUP F — TAXES + TAX_REFUND
// Fixture TAXES: amount=100, security=null, NO xact_unit
// Fixture TAX_REFUND: amount=61802, security=UUID, shares=0, NO xact_unit
//
// DIVERGENCE D7: buildUnits unconditionally creates TAX xact_unit for TAXES/TAX_REFUND
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP F — TAXES + TAX_REFUND', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let taxesId: string;
  let taxRefundId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('taxes');
    sqlite = createTestDb(dbPath);

    // TAXES fixture row 1: amount=1.00 → 100
    taxesId = createTransaction(null, sqlite, {
      type: TransactionType.TAXES,
      date: '2020-09-30T10:00',
      amount: 1.00,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 0,
      note: 'BOLLO PORTAFOGLIO TITOLI',
    });

    // TAX_REFUND fixture row 1: amount=618.02 → 61802, security=SECURITY_B
    taxRefundId = createTransaction(null, sqlite, {
      type: TransactionType.TAX_REFUND,
      date: '2024-02-01T10:00',
      amount: 618.02,
      securityId: SECURITY_B,
      accountId: DEPOSIT_UUID,
      currencyCode: 'EUR',
      fees: 0,
      taxes: 0,
      note: 'rimborso rateo tassato',
    });
  });

  afterAll(() => cleanupDb(sqlite, dbPath));

  it('F1: TAXES — type = "TAXES", amount = 100, security = NULL', () => {
    const row = readXact(sqlite, taxesId)!;
    expect(row.type).toBe('TAXES');
    expect(row.amount).toBe(100);
    expect(row.security).toBeNull();
  });

  it('F2: TAXES — no xact_unit (ppxml2db parity)', () => {
    expect(readUnits(sqlite, taxesId)).toHaveLength(0);
  });

  it('F3: TAX_REFUND — type = "TAX_REFUND", amount = 61802, security = SECURITY_B', () => {
    const row = readXact(sqlite, taxRefundId)!;
    expect(row.type).toBe('TAX_REFUND');
    expect(row.amount).toBe(61802);
    expect(row.security).toBe(SECURITY_B);
  });

  it('F4: TAX_REFUND — shares = 0 (not a share transaction)', () => {
    const row = readXact(sqlite, taxRefundId)!;
    expect(row.shares).toBe(0);
  });

  it('F5: TAX_REFUND — no xact_unit (ppxml2db parity)', () => {
    expect(readUnits(sqlite, taxRefundId)).toHaveLength(0);
  });
});

// =============================================================================
// GROUP G — Account routing: portfolio → referenceAccount (deposit)
// For each of the 9 cash-only types, passing accountId=portfolio must result
// in xact.account = referenceAccount (the linked deposit)
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP G — Account routing: portfolio → deposit', () => {
  interface RoutingTestCase {
    type: TransactionType;
    label: string;
    extra?: Partial<{
      securityId: string;
      shares: number;
      taxes: number;
    }>;
  }

  const cases: RoutingTestCase[] = [
    { type: TransactionType.DEPOSIT, label: 'DEPOSIT' },
    { type: TransactionType.REMOVAL, label: 'REMOVAL' },
    { type: TransactionType.DIVIDEND, label: 'DIVIDEND', extra: { securityId: SECURITY_A, shares: 10 } },
    { type: TransactionType.INTEREST, label: 'INTEREST' },
    { type: TransactionType.INTEREST_CHARGE, label: 'INTEREST_CHARGE' },
    { type: TransactionType.FEES, label: 'FEES' },
    { type: TransactionType.FEES_REFUND, label: 'FEES_REFUND' },
    { type: TransactionType.TAXES, label: 'TAXES' },
    { type: TransactionType.TAX_REFUND, label: 'TAX_REFUND', extra: { securityId: SECURITY_B } },
  ];

  for (const tc of cases) {
    it(`G: ${tc.label} — accountId=portfolio → xact.account=deposit`, () => {
      const dbPath = uniqueDbPath(`routing-${tc.label.toLowerCase()}`);
      const sqlite = createTestDb(dbPath);
      try {
        const xactId = createTransaction(null, sqlite, {
          type: tc.type,
          date: '2024-01-01T10:00',
          amount: 100,
          accountId: PORTFOLIO_UUID,
          currencyCode: 'EUR',
          ...tc.extra,
        });

        const row = readXact(sqlite, xactId)!;
        expect(row.account).toBe(DEPOSIT_UUID);
        expect(row.acctype).toBe('account');
      } finally {
        cleanupDb(sqlite, dbPath);
      }
    });
  }
});

// =============================================================================
// GROUP H — No cross entry for any cash-only type
// All 9 types must produce zero xact_cross_entry rows
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP H — No cross entry for cash types', () => {
  interface NoCrossEntryCase {
    type: TransactionType;
    label: string;
    extra?: Partial<{
      securityId: string;
      shares: number;
      taxes: number;
    }>;
  }

  const cases: NoCrossEntryCase[] = [
    { type: TransactionType.DEPOSIT, label: 'DEPOSIT' },
    { type: TransactionType.REMOVAL, label: 'REMOVAL' },
    { type: TransactionType.DIVIDEND, label: 'DIVIDEND', extra: { securityId: SECURITY_A, shares: 10 } },
    { type: TransactionType.INTEREST, label: 'INTEREST' },
    { type: TransactionType.INTEREST_CHARGE, label: 'INTEREST_CHARGE' },
    { type: TransactionType.FEES, label: 'FEES' },
    { type: TransactionType.FEES_REFUND, label: 'FEES_REFUND' },
    { type: TransactionType.TAXES, label: 'TAXES' },
    { type: TransactionType.TAX_REFUND, label: 'TAX_REFUND', extra: { securityId: SECURITY_B } },
  ];

  for (const tc of cases) {
    it(`H: ${tc.label} — zero xact_cross_entry rows`, () => {
      const dbPath = uniqueDbPath(`nocross-${tc.label.toLowerCase()}`);
      const sqlite = createTestDb(dbPath);
      try {
        const xactId = createTransaction(null, sqlite, {
          type: tc.type,
          date: '2024-01-01T10:00',
          amount: 100,
          accountId: DEPOSIT_UUID,
          currencyCode: 'EUR',
          ...tc.extra,
        });

        expect(readCrossEntries(sqlite, xactId)).toHaveLength(0);
        expect(readAllCrossEntries(sqlite)).toHaveLength(0);
      } finally {
        cleanupDb(sqlite, dbPath);
      }
    });
  }
});

// =============================================================================
// GROUP I — Integer guarantee: all numeric columns must be integers
// ppxml2db uses BIGINT for amount, shares, fees, taxes — no fractional values
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP I — Integer guarantee', () => {
  interface IntegerCase {
    type: TransactionType;
    label: string;
    amount: number;
    extra?: Partial<{
      securityId: string;
      shares: number;
      fees: number;
      taxes: number;
    }>;
  }

  const cases: IntegerCase[] = [
    { type: TransactionType.DEPOSIT, label: 'DEPOSIT', amount: 4000 },
    { type: TransactionType.REMOVAL, label: 'REMOVAL', amount: 14513.54 },
    { type: TransactionType.DIVIDEND, label: 'DIVIDEND', amount: 812.50, extra: { securityId: SECURITY_A, shares: 500, taxes: 101.56 } },
    { type: TransactionType.INTEREST, label: 'INTEREST', amount: 31.78, extra: { taxes: 11.17 } },
    { type: TransactionType.INTEREST_CHARGE, label: 'INTEREST_CHARGE', amount: 0.06 },
    { type: TransactionType.FEES, label: 'FEES', amount: 1.50 },
    { type: TransactionType.FEES_REFUND, label: 'FEES_REFUND', amount: 2.50 },
    { type: TransactionType.TAXES, label: 'TAXES', amount: 1.00 },
    { type: TransactionType.TAX_REFUND, label: 'TAX_REFUND', amount: 618.02, extra: { securityId: SECURITY_B } },
  ];

  for (const tc of cases) {
    it(`I: ${tc.label} — amount, shares, fees, taxes are integers`, () => {
      const dbPath = uniqueDbPath(`int-${tc.label.toLowerCase()}`);
      const sqlite = createTestDb(dbPath);
      try {
        const xactId = createTransaction(null, sqlite, {
          type: tc.type,
          date: '2024-01-01T10:00',
          amount: tc.amount,
          accountId: DEPOSIT_UUID,
          currencyCode: 'EUR',
          ...tc.extra,
        });

        const row = readXact(sqlite, xactId)!;
        expect(Number.isInteger(row.amount)).toBe(true);
        expect(Number.isInteger(row.shares)).toBe(true);
        expect(Number.isInteger(row.fees)).toBe(true);
        expect(Number.isInteger(row.taxes)).toBe(true);
        expect(Number.isInteger(row._xmlid)).toBe(true);
        expect(Number.isInteger(row._order)).toBe(true);

        // Also check xact_unit amounts if any
        for (const unit of readUnits(sqlite, xactId)) {
          expect(Number.isInteger(unit.amount)).toBe(true);
        }
      } finally {
        cleanupDb(sqlite, dbPath);
      }
    });
  }
});
