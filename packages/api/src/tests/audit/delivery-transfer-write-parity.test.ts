/**
 * Delivery & Transfer Write-Parity Tests
 *
 * Ground truth:
 *   docs/audit/fixtures/xact-delivery.json (synthetic — no real data)
 *   docs/audit/fixtures/xact-transfer.json (real TRANSFER_IN/TRANSFER_OUT pairs)
 *
 * Types covered:
 *   Group C (shares only): DELIVERY_INBOUND, DELIVERY_OUTBOUND
 *   Group D (transfers):   SECURITY_TRANSFER, TRANSFER_BETWEEN_ACCOUNTS
 *
 * Strategy:
 *   - Call service write methods (createTransaction, deleteTransaction)
 *   - Read back raw rows with direct SQL (never through service read layer)
 *   - Compare every column against fixture-derived expected values
 *
 * Divergences found:
 *   D8 (MEDIUM): DELIVERY_INBOUND in OUTFLOW_TX_TYPES / DELIVERY_OUTBOUND in INFLOW_TX_TYPES
 *                causes fees to pollute xact.amount for shares-only transactions
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { TransactionType } from '@quovibe/shared';
import {
  createTransaction,
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

const PORTFOLIO_A = 'a1a1a1a1-1111-4111-a111-111111111111';
const DEPOSIT_A   = 'a2a2a2a2-2222-4222-a222-222222222222';
const PORTFOLIO_B = 'b1b1b1b1-3333-4333-b333-333333333333';
const DEPOSIT_B   = 'b2b2b2b2-4444-4444-b444-444444444444';
const SECURITY_A  = 'c1c1c1c1-5555-4555-c555-555555555555';

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
    (1, '${PORTFOLIO_A}', 'Portfolio Alpha', 'portfolio', NULL, 0, '${DEPOSIT_A}', '', 1, 1),
    (2, '${DEPOSIT_A}',   'Deposit Alpha',   'account',   'EUR', 0, NULL,           '', 2, 2),
    (3, '${PORTFOLIO_B}', 'Portfolio Beta',  'portfolio', NULL, 0, '${DEPOSIT_B}', '', 3, 3),
    (4, '${DEPOSIT_B}',   'Deposit Beta',    'account',   'EUR', 0, NULL,           '', 4, 4);
  INSERT INTO security (_id, uuid, name, isin, currency, updatedAt)
  VALUES
    (1, '${SECURITY_A}', 'Test ETF', 'IE00TEST1234', 'EUR', '');
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
// GROUP A — DELIVERY_INBOUND: single xact row, basic structure
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP A — DELIVERY_INBOUND basic structure', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let xactId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('delivery-in');
    sqlite = createTestDb(dbPath);

    // Synthetic fixture: DELIVERY_INBOUND, 10 shares, amount=0, no fees/taxes
    xactId = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-01-15T10:00',
      amount: 0,
      shares: 10,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
    });
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('A1: creates exactly 1 xact row', () => {
    const rows = readAllXact(sqlite);
    expect(rows).toHaveLength(1);
  });

  it('A2: xact.type = TRANSFER_IN (ppxml2db mapping)', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.type).toBe('TRANSFER_IN');
  });

  it('A3: xact.account = portfolio UUID (not redirected to deposit)', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.account).toBe(PORTFOLIO_A);
  });

  it('A4: xact.acctype = portfolio', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.acctype).toBe('portfolio');
  });

  it('A5: xact.shares = input × 10^8 (positive)', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.shares).toBe(1_000_000_000); // 10 × 10^8
  });

  it('A6: xact.security = security UUID', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.security).toBe(SECURITY_A);
  });

  it('A7: xact.amount = 0 (shares-only, no cash movement)', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.amount).toBe(0);
  });

  it('A8: xact.currency = EUR, source = MANUAL', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.currency).toBe('EUR');
    expect(row.source).toBe('MANUAL');
  });
});

// =============================================================================
// GROUP B — DELIVERY_OUTBOUND: single xact row, sign convention
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP B — DELIVERY_OUTBOUND basic structure', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let xactId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('delivery-out');
    sqlite = createTestDb(dbPath);

    // Synthetic fixture: DELIVERY_OUTBOUND, 10 shares, amount=0
    xactId = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_OUTBOUND,
      date: '2025-02-20T14:30',
      amount: 0,
      shares: 10,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
    });
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('B1: creates exactly 1 xact row', () => {
    const rows = readAllXact(sqlite);
    expect(rows).toHaveLength(1);
  });

  it('B2: xact.type = TRANSFER_OUT (ppxml2db mapping)', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.type).toBe('TRANSFER_OUT');
  });

  it('B3: xact.shares positive (ppxml2db convention: sign in type name)', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.shares).toBe(1_000_000_000); // 10 × 10^8
    expect(row.shares).toBeGreaterThan(0);
  });

  it('B4: xact.amount = 0 (shares-only, no cash movement)', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.amount).toBe(0);
  });

  it('B5: xact.account = portfolio, acctype = portfolio', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.account).toBe(PORTFOLIO_A);
    expect(row.acctype).toBe('portfolio');
  });

  it('B6: xact.security = security UUID', () => {
    const row = readXact(sqlite, xactId)!;
    expect(row.security).toBe(SECURITY_A);
  });
});

// =============================================================================
// GROUP C — DELIVERY amount field and xact_unit structure
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP C — DELIVERY amount and units', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('delivery-units');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('C1: DELIVERY_INBOUND no fees — zero xact_unit rows', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-03-01',
      amount: 0,
      shares: 5,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
    });
    expect(readUnits(sqlite, id)).toHaveLength(0);
  });

  it('C2: DELIVERY_INBOUND with fees — xact.amount remains 0 (D8 parity)', () => {
    // D8: DELIVERY is shares-only; fees must NOT pollute xact.amount
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-03-02',
      amount: 0,
      shares: 5,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 10,
    });
    const row = readXact(sqlite, id)!;
    expect(row.amount).toBe(0);
  });

  it('C3: DELIVERY_INBOUND with fees — FEE xact_unit created, amount = fees × 100', () => {
    // Find the row created by C2 (last DELIVERY_INBOUND with fees)
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-03-03',
      amount: 0,
      shares: 8,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 15.50,
    });
    const units = readUnits(sqlite, id);
    expect(units).toHaveLength(1);
    expect(units[0].type).toBe('FEE');
    expect(units[0].amount).toBe(1550); // 15.50 × 100
  });

  it('C4: DELIVERY_OUTBOUND with fees — FEE xact_unit created', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_OUTBOUND,
      date: '2025-03-04',
      amount: 0,
      shares: 3,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 7.25,
    });
    const units = readUnits(sqlite, id);
    expect(units).toHaveLength(1);
    expect(units[0].type).toBe('FEE');
    expect(units[0].amount).toBe(725); // 7.25 × 100
  });

  it('C5: DELIVERY_OUTBOUND with fees — xact.amount remains 0 (D8 parity)', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_OUTBOUND,
      date: '2025-03-05',
      amount: 0,
      shares: 2,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 5,
    });
    const row = readXact(sqlite, id)!;
    expect(row.amount).toBe(0);
  });

  it('C6: no xact_cross_entry for either delivery type', () => {
    // All deliveries created above should have zero cross entries
    const allCE = readAllCrossEntries(sqlite);
    expect(allCE).toHaveLength(0);
  });
});

// =============================================================================
// GROUP D — SECURITY_TRANSFER: dual-entry structure
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP D — SECURITY_TRANSFER full structure', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let sourceId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('sec-transfer');
    sqlite = createTestDb(dbPath);

    sourceId = createTransaction(null, sqlite, {
      type: TransactionType.SECURITY_TRANSFER,
      date: '2025-06-01T10:00',
      amount: 0,
      shares: 50,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      crossAccountId: PORTFOLIO_B,
    });
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('D1: creates exactly 2 xact rows', () => {
    const rows = readAllXact(sqlite);
    expect(rows).toHaveLength(2);
  });

  it('D2: source row type = TRANSFER_OUT', () => {
    const source = readXact(sqlite, sourceId)!;
    expect(source.type).toBe('TRANSFER_OUT');
  });

  it('D3: dest row type = TRANSFER_IN', () => {
    const rows = readAllXact(sqlite);
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(dest.type).toBe('TRANSFER_IN');
  });

  it('D4: source account = PORTFOLIO_A, acctype = portfolio', () => {
    const source = readXact(sqlite, sourceId)!;
    expect(source.account).toBe(PORTFOLIO_A);
    expect(source.acctype).toBe('portfolio');
  });

  it('D5: dest account = PORTFOLIO_B (crossAccountId), acctype = portfolio', () => {
    const rows = readAllXact(sqlite);
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(dest.account).toBe(PORTFOLIO_B);
    expect(dest.acctype).toBe('portfolio');
  });

  it('D6: both rows have same positive shares (shares × 10^8)', () => {
    const rows = readAllXact(sqlite);
    const source = rows.find(r => r.uuid === sourceId)!;
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(source.shares).toBe(5_000_000_000); // 50 × 10^8
    expect(dest.shares).toBe(5_000_000_000);
  });

  it('D7: both rows carry security UUID', () => {
    const rows = readAllXact(sqlite);
    const source = rows.find(r => r.uuid === sourceId)!;
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(source.security).toBe(SECURITY_A);
    expect(dest.security).toBe(SECURITY_A);
  });

  it('D8: cross entry type = portfolio-transfer, accounts correct', () => {
    const entries = readCrossEntries(sqlite, sourceId);
    expect(entries).toHaveLength(1);
    const ce = entries[0];
    expect(ce.type).toBe('portfolio-transfer');
    expect(ce.from_acc).toBe(PORTFOLIO_A);
    expect(ce.to_acc).toBe(PORTFOLIO_B);

    // to_xact points to dest row, not self-referential
    const rows = readAllXact(sqlite);
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(ce.to_xact).toBe(dest.uuid);
    expect(ce.from_xact).toBe(sourceId);
  });
});

// =============================================================================
// GROUP E — TRANSFER_BETWEEN_ACCOUNTS: dual-entry structure (fixture parity)
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP E — TRANSFER_BETWEEN_ACCOUNTS full structure', () => {
  let sqlite: Database.Database;
  let dbPath: string;
  let sourceId: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('acct-transfer');
    sqlite = createTestDb(dbPath);

    // Fixture: TRANSFER_OUT + TRANSFER_IN pair, amount=180000 (€1800)
    sourceId = createTransaction(null, sqlite, {
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      date: '2024-03-23T10:00',
      amount: 1800,
      accountId: DEPOSIT_A,
      crossAccountId: DEPOSIT_B,
      note: 'GIROFONDI VERSO BANCA PROGETTO',
    });
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('E1: creates exactly 2 xact rows', () => {
    const rows = readAllXact(sqlite);
    expect(rows).toHaveLength(2);
  });

  it('E2: source type = TRANSFER_OUT, dest type = TRANSFER_IN', () => {
    const rows = readAllXact(sqlite);
    const source = rows.find(r => r.uuid === sourceId)!;
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(source.type).toBe('TRANSFER_OUT');
    expect(dest.type).toBe('TRANSFER_IN');
  });

  it('E3: source account = DEPOSIT_A, dest account = DEPOSIT_B', () => {
    const rows = readAllXact(sqlite);
    const source = rows.find(r => r.uuid === sourceId)!;
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(source.account).toBe(DEPOSIT_A);
    expect(dest.account).toBe(DEPOSIT_B);
  });

  it('E4: both rows shares = 0 (no securities involvement)', () => {
    const rows = readAllXact(sqlite);
    for (const row of rows) {
      expect(row.shares).toBe(0);
    }
  });

  it('E5: both rows security = null', () => {
    const rows = readAllXact(sqlite);
    for (const row of rows) {
      expect(row.security).toBeNull();
    }
  });

  it('E6: both rows amount = 180000 (€1800 × 100, matching fixture)', () => {
    const rows = readAllXact(sqlite);
    for (const row of rows) {
      expect(row.amount).toBe(180000);
    }
  });

  it('E7: cross entry type = account-transfer, from_acc/to_acc correct', () => {
    const entries = readCrossEntries(sqlite, sourceId);
    expect(entries).toHaveLength(1);
    const ce = entries[0];
    expect(ce.type).toBe('account-transfer');
    expect(ce.from_acc).toBe(DEPOSIT_A);
    expect(ce.to_acc).toBe(DEPOSIT_B);
    expect(ce.from_xact).toBe(sourceId);
    // to_xact points to dest row
    const rows = readAllXact(sqlite);
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(ce.to_xact).toBe(dest.uuid);
  });

  it('E8: dest row fees = 0, taxes = 0, acctype = account', () => {
    const rows = readAllXact(sqlite);
    const dest = rows.find(r => r.uuid !== sourceId)!;
    expect(dest.fees).toBe(0);
    expect(dest.taxes).toBe(0);
    expect(dest.acctype).toBe('account');
  });
});

// =============================================================================
// GROUP F — Missing crossAccountId validation
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP F — Missing crossAccountId validation', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('validation');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('F1: SECURITY_TRANSFER without crossAccountId → error with statusCode 400', () => {
    expect(() => {
      createTransaction(null, sqlite, {
        type: TransactionType.SECURITY_TRANSFER,
        date: '2025-06-01',
        amount: 0,
        shares: 10,
        securityId: SECURITY_A,
        accountId: PORTFOLIO_A,
        // no crossAccountId
      });
    }).toThrow();

    try {
      createTransaction(null, sqlite, {
        type: TransactionType.SECURITY_TRANSFER,
        date: '2025-06-01',
        amount: 0,
        shares: 10,
        securityId: SECURITY_A,
        accountId: PORTFOLIO_A,
      });
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number };
      expect(e.statusCode).toBe(400);
      expect(e.message).toContain('crossAccountId');
    }
  });

  it('F2: TRANSFER_BETWEEN_ACCOUNTS without crossAccountId → error with statusCode 400', () => {
    expect(() => {
      createTransaction(null, sqlite, {
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        date: '2024-03-23',
        amount: 500,
        accountId: DEPOSIT_A,
        // no crossAccountId
      });
    }).toThrow();

    try {
      createTransaction(null, sqlite, {
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        date: '2024-03-23',
        amount: 500,
        accountId: DEPOSIT_A,
      });
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number };
      expect(e.statusCode).toBe(400);
      expect(e.message).toContain('crossAccountId');
    }
  });

  it('F3: no xact rows created when validation fails (transaction rolled back)', () => {
    const rowsBefore = readAllXact(sqlite);
    try {
      createTransaction(null, sqlite, {
        type: TransactionType.SECURITY_TRANSFER,
        date: '2025-06-01',
        amount: 0,
        shares: 10,
        securityId: SECURITY_A,
        accountId: PORTFOLIO_A,
      });
    } catch {
      // expected
    }
    const rowsAfter = readAllXact(sqlite);
    expect(rowsAfter.length).toBe(rowsBefore.length);
  });
});

// =============================================================================
// GROUP G — Delete delivery: single row deleted, no orphans
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP G — Delete delivery', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('del-delivery');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('G1: delete DELIVERY_INBOUND — 0 xact rows remain', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-04-01',
      amount: 0,
      shares: 10,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 5,
    });
    // Verify created
    expect(readAllXact(sqlite).length).toBeGreaterThanOrEqual(1);
    expect(readUnits(sqlite, id).length).toBe(1); // FEE unit

    deleteTransaction(null, sqlite, id);

    expect(readXact(sqlite, id)).toBeUndefined();
  });

  it('G2: delete DELIVERY_INBOUND — 0 xact_unit rows remain', () => {
    // All units from G1 should be cleaned up
    expect(readAllUnits(sqlite)).toHaveLength(0);
  });

  it('G3: delete DELIVERY_OUTBOUND — xact row deleted', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_OUTBOUND,
      date: '2025-04-02',
      amount: 0,
      shares: 7,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
    });
    expect(readXact(sqlite, id)).toBeDefined();

    deleteTransaction(null, sqlite, id);

    expect(readXact(sqlite, id)).toBeUndefined();
    expect(readAllXact(sqlite)).toHaveLength(0);
  });

  it('G4: no orphaned cross entries after delivery delete', () => {
    expect(readAllCrossEntries(sqlite)).toHaveLength(0);
  });
});

// =============================================================================
// GROUP H — Delete transfer: both rows + cross entry deleted
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP H — Delete transfer', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('del-transfer');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('H1: delete TRANSFER_BETWEEN_ACCOUNTS — 0 xact rows remain', () => {
    const sourceId = createTransaction(null, sqlite, {
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      date: '2024-03-23T10:00',
      amount: 1800,
      accountId: DEPOSIT_A,
      crossAccountId: DEPOSIT_B,
    });
    expect(readAllXact(sqlite)).toHaveLength(2);

    deleteTransaction(null, sqlite, sourceId);

    expect(readAllXact(sqlite)).toHaveLength(0);
  });

  it('H2: delete TRANSFER_BETWEEN_ACCOUNTS — 0 cross_entry rows remain', () => {
    expect(readAllCrossEntries(sqlite)).toHaveLength(0);
  });

  it('H3: delete SECURITY_TRANSFER — 0 xact rows remain', () => {
    const sourceId = createTransaction(null, sqlite, {
      type: TransactionType.SECURITY_TRANSFER,
      date: '2025-06-01T10:00',
      amount: 0,
      shares: 50,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      crossAccountId: PORTFOLIO_B,
      fees: 8,
    });
    expect(readAllXact(sqlite)).toHaveLength(2);
    expect(readAllUnits(sqlite).length).toBeGreaterThanOrEqual(1); // FEE unit

    deleteTransaction(null, sqlite, sourceId);

    expect(readAllXact(sqlite)).toHaveLength(0);
  });

  it('H4: delete SECURITY_TRANSFER — 0 xact_unit rows remain', () => {
    expect(readAllUnits(sqlite)).toHaveLength(0);
  });

  it('H5: delete SECURITY_TRANSFER — 0 cross_entry rows remain', () => {
    expect(readAllCrossEntries(sqlite)).toHaveLength(0);
  });
});

// =============================================================================
// GROUP I — Integer guarantee: all numeric columns are integers
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP I — Integer guarantee', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('int-check');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  function assertIntegerColumns(row: XactRow): void {
    expect(Number.isInteger(row.amount)).toBe(true);
    expect(Number.isInteger(row.shares)).toBe(true);
    expect(Number.isInteger(row.fees)).toBe(true);
    expect(Number.isInteger(row.taxes)).toBe(true);
    expect(Number.isInteger(row._xmlid)).toBe(true);
    expect(Number.isInteger(row._order)).toBe(true);
  }

  function assertUnitIntegerColumns(unit: UnitRow): void {
    expect(Number.isInteger(unit.amount)).toBe(true);
  }

  it('I1: DELIVERY_INBOUND — all numeric columns are integers', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-05-01',
      amount: 0,
      shares: 12.5,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 3.75,
    });
    const row = readXact(sqlite, id)!;
    assertIntegerColumns(row);
    for (const unit of readUnits(sqlite, id)) {
      assertUnitIntegerColumns(unit);
    }
  });

  it('I2: DELIVERY_OUTBOUND — all numeric columns are integers', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_OUTBOUND,
      date: '2025-05-02',
      amount: 0,
      shares: 7.333,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 2.10,
    });
    const row = readXact(sqlite, id)!;
    assertIntegerColumns(row);
    for (const unit of readUnits(sqlite, id)) {
      assertUnitIntegerColumns(unit);
    }
  });

  it('I3: SECURITY_TRANSFER — all numeric columns are integers (both rows)', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.SECURITY_TRANSFER,
      date: '2025-05-03',
      amount: 0,
      shares: 33.33,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      crossAccountId: PORTFOLIO_B,
      fees: 1.99,
    });
    const rows = readAllXact(sqlite).filter(r =>
      r.uuid === id || readCrossEntries(sqlite, id).some(ce => ce.to_xact === r.uuid),
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      assertIntegerColumns(row);
    }
    for (const unit of readUnits(sqlite, id)) {
      assertUnitIntegerColumns(unit);
    }
  });

  it('I4: TRANSFER_BETWEEN_ACCOUNTS — all numeric columns are integers (both rows)', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      date: '2025-05-04',
      amount: 1234.56,
      accountId: DEPOSIT_A,
      crossAccountId: DEPOSIT_B,
    });
    const rows = readAllXact(sqlite).filter(r =>
      r.uuid === id || readCrossEntries(sqlite, id).some(ce => ce.to_xact === r.uuid),
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      assertIntegerColumns(row);
    }
  });
});

// =============================================================================
// GROUP J — Additional parity checks
// =============================================================================

describe.skipIf(!hasSqliteBindings)('GROUP J — Additional parity checks', () => {
  let sqlite: Database.Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = uniqueDbPath('extra');
    sqlite = createTestDb(dbPath);
  });

  afterAll(() => {
    if (!hasSqliteBindings) return;
    cleanupDb(sqlite, dbPath);
  });

  it('J1: DELIVERY_INBOUND xact.fees stored as hecto-units', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-07-01',
      amount: 0,
      shares: 5,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      fees: 12.50,
      taxes: 3.00,
    });
    const row = readXact(sqlite, id)!;
    expect(row.fees).toBe(1250);  // 12.50 × 100
    expect(row.taxes).toBe(300);  // 3.00 × 100
  });

  it('J2: SECURITY_TRANSFER — source has fees, dest has fees=0 taxes=0', () => {
    const sourceId = createTransaction(null, sqlite, {
      type: TransactionType.SECURITY_TRANSFER,
      date: '2025-07-02',
      amount: 0,
      shares: 20,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      crossAccountId: PORTFOLIO_B,
      fees: 25,
    });
    const source = readXact(sqlite, sourceId)!;
    expect(source.fees).toBe(2500); // 25 × 100
    const rows = readAllXact(sqlite);
    const dest = rows.find(r => r.uuid !== sourceId && r.type === 'TRANSFER_IN'
      && r.account === PORTFOLIO_B)!;
    expect(dest.fees).toBe(0);
    expect(dest.taxes).toBe(0);
  });

  it('J3: TRANSFER_BETWEEN_ACCOUNTS — no xact_unit rows (no fx)', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      date: '2025-07-03',
      amount: 500,
      accountId: DEPOSIT_A,
      crossAccountId: DEPOSIT_B,
    });
    expect(readUnits(sqlite, id)).toHaveLength(0);
  });

  it('J4: TRANSFER_BETWEEN_ACCOUNTS with fxRate — FOREX xact_unit created', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      date: '2025-07-04',
      amount: 1000,
      accountId: DEPOSIT_A,
      crossAccountId: DEPOSIT_B,
      fxRate: 1.08,
      fxCurrencyCode: 'USD',
    });
    const units = readUnits(sqlite, id);
    expect(units).toHaveLength(1);
    expect(units[0].type).toBe('FOREX');
    expect(units[0].amount).toBe(100000); // 1000 × 100
    expect(units[0].forex_amount).toBe(108000); // 1000 × 1.08 × 100
    expect(units[0].forex_currency).toBe('USD');
    expect(units[0].exchangeRate).toBe('1.08');
  });

  it('J5: DELIVERY_INBOUND — no TAX xact_unit even when taxes > 0', () => {
    // buildUnits for DELIVERY types only creates FEE, never TAX
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-07-05',
      amount: 0,
      shares: 3,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      taxes: 20,
    });
    const units = readUnits(sqlite, id);
    // No TAX unit, and no FEE unit (fees not provided)
    expect(units).toHaveLength(0);
    // But xact.taxes IS stored
    const row = readXact(sqlite, id)!;
    expect(row.taxes).toBe(2000); // 20 × 100
  });

  it('J6: SECURITY_TRANSFER — FEE xact_unit when fees > 0', () => {
    const sourceId = createTransaction(null, sqlite, {
      type: TransactionType.SECURITY_TRANSFER,
      date: '2025-07-06',
      amount: 0,
      shares: 15,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
      crossAccountId: PORTFOLIO_B,
      fees: 9.50,
    });
    const units = readUnits(sqlite, sourceId);
    expect(units).toHaveLength(1);
    expect(units[0].type).toBe('FEE');
    expect(units[0].amount).toBe(950); // 9.50 × 100
  });

  it('J7: DELIVERY_INBOUND date preserved with time component', () => {
    const id = createTransaction(null, sqlite, {
      type: TransactionType.DELIVERY_INBOUND,
      date: '2025-07-07T14:30',
      amount: 0,
      shares: 1,
      securityId: SECURITY_A,
      accountId: PORTFOLIO_A,
    });
    const row = readXact(sqlite, id)!;
    expect(row.date).toBe('2025-07-07T14:30');
  });

  it('J8: TRANSFER_BETWEEN_ACCOUNTS note propagated to both rows', () => {
    const sourceId = createTransaction(null, sqlite, {
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      date: '2025-07-08',
      amount: 200,
      accountId: DEPOSIT_A,
      crossAccountId: DEPOSIT_B,
      note: 'Internal transfer test',
    });
    const rows = readAllXact(sqlite);
    const source = rows.find(r => r.uuid === sourceId)!;
    const dest = rows.find(r =>
      r.uuid !== sourceId && r.type === 'TRANSFER_IN' && r.date === '2025-07-08')!;
    expect(source.note).toBe('Internal transfer test');
    expect(dest.note).toBe('Internal transfer test');
  });
});
