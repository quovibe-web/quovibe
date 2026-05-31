// Locks the bootstrap-time backfill of synthetic GROSS_VALUE FOREX units
// for cross-currency trades that were imported before this work (older
// PP-XML imports, manual entries pre-fix). See
// docs/architecture/multi-currency.md.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyBootstrap } from '../apply-bootstrap';

interface UnitRow {
  type: string;
  amount: number;
  currency: string;
  forex_amount: number | null;
  forex_currency: string | null;
  exchangeRate: string | null;
}

function ensureAccount(db: Database.Database, uuid: string, type: 'portfolio' | 'account', currency: string): void {
  const exists = db.prepare('SELECT 1 FROM account WHERE uuid = ?').get(uuid);
  if (exists) return;
  db.prepare(
    `INSERT INTO account (
       uuid, name, type, isRetired, currency, updatedAt, _xmlid, _order
     ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(uuid, `Account ${uuid}`, type, currency, '2025-01-01T00:00', 1, 1);
}

function seedTrade(
  db: Database.Database,
  opts: {
    xact: string;
    type: 'BUY' | 'SELL' | 'DIVIDENDS' | 'DELIVERY_INBOUND' | 'TRANSFER_IN';
    date: string;
    depositCurrency: string;
    securityCurrency: string;
    amountHecto: number;
    securityId?: string;
  },
): void {
  const securityId = opts.securityId ?? 'sec-1';
  // Ensure security row exists.
  const existing = db
    .prepare('SELECT 1 FROM security WHERE uuid = ?')
    .get(securityId);
  if (!existing) {
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    ).run(securityId, 'Test Security', opts.securityCurrency, 0, '2025-01-01T00:00');
  }
  ensureAccount(db, 'acc-1', 'portfolio', opts.depositCurrency);
  db.prepare(
    `INSERT INTO xact (
       uuid, type, date, currency, amount, shares, security, account,
       acctype, updatedAt, _xmlid, _order
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.xact, opts.type, opts.date, opts.depositCurrency, opts.amountHecto,
    100000000, securityId, 'acc-1', 'portfolio', '2025-01-01T00:00', 1, 1,
  );
}

function seedRate(
  db: Database.Database,
  from: string,
  to: string,
  date: string,
  rate: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO vf_exchange_rate (date, from_currency, to_currency, rate)
     VALUES (?, ?, ?, ?)`,
  ).run(date, from, to, rate);
}

function readUnits(db: Database.Database, xact: string): UnitRow[] {
  return db
    .prepare(
      `SELECT type, amount, currency, forex_amount, forex_currency, exchangeRate
         FROM xact_unit WHERE xact = ? ORDER BY type`,
    )
    .all(xact) as UnitRow[];
}

describe('backfillCrossCurrencyGrossUnits', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);
  });

  it('inserts a synthetic GROSS_VALUE FOREX unit for a cross-currency BUY missing one', () => {
    seedRate(db, 'EUR', 'USD', '2025-01-15', '1.1000');
    seedTrade(db, {
      xact: 'tx-buy-usd',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'USD',
      amountHecto: 36660, // 366.60 EUR
    });

    applyBootstrap(db);

    const units = readUnits(db, 'tx-buy-usd');
    expect(units).toHaveLength(1);
    expect(units[0].type).toBe('GROSS_VALUE');
    expect(units[0].amount).toBe(36660);
    expect(units[0].currency).toBe('EUR');
    expect(units[0].forex_amount).toBe(40326); // 366.60 × 1.10 × 100 = 40,326
    expect(units[0].forex_currency).toBe('USD');
    expect(units[0].exchangeRate).toBe('1.1');
  });

  it('skips same-currency trades', () => {
    seedTrade(db, {
      xact: 'tx-buy-eur',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'EUR',
      amountHecto: 50000,
    });

    applyBootstrap(db);

    const units = readUnits(db, 'tx-buy-eur');
    expect(units).toHaveLength(0);
  });

  it('skips trades that already have a GROSS_VALUE FOREX unit', () => {
    seedRate(db, 'EUR', 'USD', '2025-01-15', '1.1000');
    seedTrade(db, {
      xact: 'tx-with-forex',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'USD',
      amountHecto: 36660,
    });
    // Pre-existing GROSS_VALUE FOREX unit from PP-XML.
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES (?, 'GROSS_VALUE', ?, ?, ?, ?, ?)`,
    ).run('tx-with-forex', 36660, 'EUR', 39000, 'USD', '1.0638');

    applyBootstrap(db);

    const units = readUnits(db, 'tx-with-forex');
    expect(units).toHaveLength(1);
    // Untouched — backfill did NOT clobber the existing rate.
    expect(units[0].forex_amount).toBe(39000);
    expect(units[0].exchangeRate).toBe('1.0638');
  });

  it('skips trades that already have a type=FOREX unit (quovibe-native writer)', () => {
    // transaction.service.ts > buildUnits emits type='FOREX' (not
    // 'GROSS_VALUE') for cross-currency BUY/SELL/DIVIDEND. The guard
    // MUST match this row or the backfill will synthesise a duplicate
    // and the cost basis will double. This pins the dual-writer
    // acceptance documented in apply-bootstrap.ts.
    seedRate(db, 'EUR', 'USD', '2025-01-15', '1.1000');
    seedTrade(db, {
      xact: 'tx-with-qv-forex',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'USD',
      amountHecto: 40679,
    });
    // quovibe-native FOREX-typed unit (matches Test-2026-05-16.db shape).
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES (?, 'FOREX', ?, ?, ?, ?, ?)`,
    ).run('tx-with-qv-forex', 40679, 'EUR', 47301, 'USD', '1.1628');

    applyBootstrap(db);

    const units = readUnits(db, 'tx-with-qv-forex');
    expect(units).toHaveLength(1);
    expect(units[0].type).toBe('FOREX');
    expect(units[0].forex_amount).toBe(47301);
    expect(units[0].exchangeRate).toBe('1.1628');
  });

  it('is idempotent — re-running adds no further rows', () => {
    seedRate(db, 'EUR', 'USD', '2025-01-15', '1.1000');
    seedTrade(db, {
      xact: 'tx-idem',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'USD',
      amountHecto: 36660,
    });

    applyBootstrap(db);
    const after1 = readUnits(db, 'tx-idem').length;
    applyBootstrap(db);
    const after2 = readUnits(db, 'tx-idem').length;

    expect(after1).toBe(1);
    expect(after2).toBe(1);
  });

  it('skips when vf_exchange_rate has no rate for the trade date', () => {
    // No rate seeded.
    seedTrade(db, {
      xact: 'tx-norate',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'USD',
      amountHecto: 36660,
    });

    applyBootstrap(db);

    const units = readUnits(db, 'tx-norate');
    expect(units).toHaveLength(0);
  });

  it('forward-fills the rate from the closest earlier date when exact date is missing', () => {
    // Rate seeded one week before trade.
    seedRate(db, 'EUR', 'USD', '2025-01-08', '1.0500');
    seedTrade(db, {
      xact: 'tx-fwdfill',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'USD',
      amountHecto: 36660,
    });

    applyBootstrap(db);

    const units = readUnits(db, 'tx-fwdfill');
    expect(units).toHaveLength(1);
    expect(units[0].forex_amount).toBe(38493); // 36660 × 1.05 = 38493
    expect(units[0].exchangeRate).toBe('1.05');
  });

  it('uses inverse-rate fallback when only the reverse pair is stored', () => {
    // Only USD→EUR stored (reverse direction).
    seedRate(db, 'USD', 'EUR', '2025-01-15', '0.9091'); // 1/1.10
    seedTrade(db, {
      xact: 'tx-inverse',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'EUR',
      securityCurrency: 'USD',
      amountHecto: 36660,
    });

    applyBootstrap(db);

    const units = readUnits(db, 'tx-inverse');
    expect(units).toHaveLength(1);
    // 36660 × (1/0.9091) ≈ 40,326
    expect(units[0].forex_amount).toBeGreaterThan(40300);
    expect(units[0].forex_amount).toBeLessThan(40360);
  });

  it('processes SELL, DIVIDEND, DELIVERY_INBOUND, and TRANSFER_IN', () => {
    seedRate(db, 'EUR', 'USD', '2025-01-15', '1.1000');
    seedTrade(db, { xact: 'tx-sell', type: 'SELL', date: '2025-01-15', depositCurrency: 'EUR', securityCurrency: 'USD', amountHecto: 10000 });
    seedTrade(db, { xact: 'tx-div', type: 'DIVIDENDS', date: '2025-01-15', depositCurrency: 'EUR', securityCurrency: 'USD', amountHecto: 500 });
    seedTrade(db, { xact: 'tx-deliv', type: 'DELIVERY_INBOUND', date: '2025-01-15', depositCurrency: 'EUR', securityCurrency: 'USD', amountHecto: 20000 });
    seedTrade(db, { xact: 'tx-xfer', type: 'TRANSFER_IN', date: '2025-01-15', depositCurrency: 'EUR', securityCurrency: 'USD', amountHecto: 15000 });

    applyBootstrap(db);

    for (const xid of ['tx-sell', 'tx-div', 'tx-deliv', 'tx-xfer']) {
      const units = readUnits(db, xid);
      expect(units, `${xid} should have a synthesised GROSS_VALUE`).toHaveLength(1);
      expect(units[0].type).toBe('GROSS_VALUE');
      expect(units[0].forex_currency).toBe('USD');
    }
  });

  it('non-EUR-cross pairs resolve via EUR triangulation when EUR pairs exist', () => {
    // getRate triangulates from→to as (EUR→to) / (EUR→from) when no direct
    // or inverse pair exists. GBP→USD = (EUR→USD) / (EUR→GBP) = 1.10 / 0.85.
    seedRate(db, 'EUR', 'GBP', '2025-01-15', '0.85');
    seedRate(db, 'EUR', 'USD', '2025-01-15', '1.10');
    seedTrade(db, {
      xact: 'tx-tri',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'GBP',
      securityCurrency: 'USD',
      amountHecto: 100000,
    });

    applyBootstrap(db);

    const units = readUnits(db, 'tx-tri');
    expect(units).toHaveLength(1);
    expect(units[0].type).toBe('GROSS_VALUE');
    expect(units[0].forex_currency).toBe('USD');
  });

  it('non-EUR-cross pairs remain unresolved when no triangulation path exists', () => {
    // No EUR pairs seeded — triangulation cannot help. No direct or inverse
    // GBP↔USD either. Backfill leaves the trade without a synthetic FOREX unit.
    seedTrade(db, {
      xact: 'tx-no-fx',
      type: 'BUY',
      date: '2025-01-15',
      depositCurrency: 'GBP',
      securityCurrency: 'USD',
      amountHecto: 100000,
    });

    applyBootstrap(db);

    const units = readUnits(db, 'tx-no-fx');
    expect(units).toHaveLength(0);
  });
});
