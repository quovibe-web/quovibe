import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { upsertPrice, editPrice, deletePrices, deleteAllPrices, derivePricesFromTransactions } from '../manual-prices.service';

const SEC = 'sec-1';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  applyBootstrap(db);
  db.prepare(`INSERT INTO security (uuid, name, currency, updatedAt) VALUES (?, 'Test', 'EUR', '2025-01-01T00:00:00')`).run(SEC);
  return db;
}

function readPrice(db: Database.Database, date: string) {
  return db.prepare(`SELECT tstamp, value, open FROM price WHERE security = ? AND tstamp = ?`).get(SEC, date) as
    | { tstamp: string; value: number; open: number | null } | undefined;
}

describe('upsertPrice', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('inserts a new price row (value scaled x1e8) and syncs latest_price', () => {
    upsertPrice(db, SEC, { date: '2025-03-14', value: '101.25' });
    const row = readPrice(db, '2025-03-14');
    expect(row?.value).toBe(10125000000); // 101.25 x 1e8
    const lp = db.prepare(`SELECT tstamp, value FROM latest_price WHERE security = ?`).get(SEC) as { tstamp: string; value: number };
    expect(lp.tstamp).toBe('2025-03-14');
    expect(lp.value).toBe(10125000000);
  });

  it('overwrites an existing same-date row', () => {
    upsertPrice(db, SEC, { date: '2025-03-14', value: '100' });
    upsertPrice(db, SEC, { date: '2025-03-14', value: '200' });
    expect(readPrice(db, '2025-03-14')?.value).toBe(20000000000);
  });

  it('stores optional OHLCV', () => {
    upsertPrice(db, SEC, { date: '2025-03-14', value: '101', open: '100', high: '102', low: '99', volume: 1500 });
    const row = db.prepare(`SELECT open, high, low, volume FROM price WHERE security = ? AND tstamp = ?`).get(SEC, '2025-03-14') as { open: number; high: number; low: number; volume: number };
    expect(row.open).toBe(10000000000);
    expect(row.volume).toBe(1500);
  });
});

describe('editPrice', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('updates value in place when the date is unchanged', () => {
    upsertPrice(db, SEC, { date: '2025-03-14', value: '100' });
    editPrice(db, SEC, '2025-03-14', { date: '2025-03-14', value: '150' });
    expect(readPrice(db, '2025-03-14')?.value).toBe(15000000000);
  });

  it('moves the row when the date changes (old date removed, new date written, latest_price follows)', () => {
    upsertPrice(db, SEC, { date: '2025-03-14', value: '100' });
    upsertPrice(db, SEC, { date: '2025-03-20', value: '200' }); // 2025-03-20 is the max
    editPrice(db, SEC, '2025-03-20', { date: '2025-03-15', value: '150' }); // move max earlier
    expect(readPrice(db, '2025-03-20')).toBeUndefined();
    expect(readPrice(db, '2025-03-15')?.value).toBe(15000000000);
    const lp = db.prepare(`SELECT tstamp FROM latest_price WHERE security = ?`).get(SEC) as { tstamp: string };
    expect(lp.tstamp).toBe('2025-03-15'); // latest_price followed the new global max
  });

  it('overwrites the target date when changing onto an occupied date', () => {
    upsertPrice(db, SEC, { date: '2025-03-14', value: '100' });
    upsertPrice(db, SEC, { date: '2025-03-20', value: '999' });
    editPrice(db, SEC, '2025-03-14', { date: '2025-03-20', value: '100' });
    expect(readPrice(db, '2025-03-14')).toBeUndefined();
    expect(readPrice(db, '2025-03-20')?.value).toBe(10000000000);
  });
});

describe('deletePrices', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    upsertPrice(db, SEC, { date: '2025-01-01', value: '100' });
    upsertPrice(db, SEC, { date: '2025-02-01', value: '200' });
    upsertPrice(db, SEC, { date: '2025-03-01', value: '300' });
  });

  it('deletes a single date and re-syncs latest_price to the new max', () => {
    deletePrices(db, SEC, ['2025-03-01']); // remove the current max
    expect(readPrice(db, '2025-03-01')).toBeUndefined();
    const lp = db.prepare(`SELECT tstamp FROM latest_price WHERE security = ?`).get(SEC) as { tstamp: string };
    expect(lp.tstamp).toBe('2025-02-01'); // latest_price moved down
  });

  it('deletes multiple dates', () => {
    deletePrices(db, SEC, ['2025-01-01', '2025-02-01']);
    expect(readPrice(db, '2025-01-01')).toBeUndefined();
    expect(readPrice(db, '2025-02-01')).toBeUndefined();
    expect(readPrice(db, '2025-03-01')?.value).toBe(30000000000);
  });

  it('is a no-op on an empty dates array', () => {
    deletePrices(db, SEC, []);
    expect(readPrice(db, '2025-03-01')?.value).toBe(30000000000);
    const cnt = db.prepare(`SELECT COUNT(*) c FROM price WHERE security = ?`).get(SEC) as { c: number };
    expect(cnt.c).toBe(3);
  });
});

describe('deleteAllPrices', () => {
  it('removes every price row and clears latest_price', () => {
    const db = freshDb();
    upsertPrice(db, SEC, { date: '2025-01-01', value: '100' });
    upsertPrice(db, SEC, { date: '2025-02-01', value: '200' });
    deleteAllPrices(db, SEC);
    expect(db.prepare(`SELECT COUNT(*) c FROM price WHERE security = ?`).get(SEC)).toEqual({ c: 0 });
    expect(db.prepare(`SELECT * FROM latest_price WHERE security = ?`).get(SEC)).toBeUndefined();
  });
});

// Seed one securities-side xact (shares>0) + optional FEE/TAX/FOREX units.
// Requires an account with uuid='acc-1' and type='portfolio' in the DB.
function seedTrade(
  db: Database.Database,
  opts: {
    uuid: string;
    type: 'BUY' | 'SELL';
    date: string;
    shares: number;
    amountHecto: number;
    currency: string;
    feeHecto?: number;
    taxHecto?: number;
    forexAmountHecto?: number;
    forexCurrency?: string;
    rate?: string;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO account (uuid, type, name, updatedAt, _xmlid, _order)
     VALUES ('acc-1', 'portfolio', 'Test Account', '2025-01-01T00:00:00', 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO xact (uuid, type, date, acctype, account, security, shares, amount, currency, updatedAt, _xmlid, _order)
     VALUES (?, ?, ?, 'portfolio', 'acc-1', ?, ?, ?, ?, '2025-01-01T00:00:00', 0, 0)`,
  ).run(opts.uuid, opts.type, opts.date, SEC, opts.shares, opts.amountHecto, opts.currency);
  const unit = db.prepare(
    `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  if (opts.feeHecto) unit.run(opts.uuid, 'FEE', opts.feeHecto, opts.currency, null, null, null);
  if (opts.taxHecto) unit.run(opts.uuid, 'TAX', opts.taxHecto, opts.currency, null, null, null);
  if (opts.forexAmountHecto != null)
    unit.run(opts.uuid, 'FOREX', opts.amountHecto, opts.currency, opts.forexAmountHecto, opts.forexCurrency, opts.rate ?? null);
}

describe('derivePricesFromTransactions', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); }); // SEC currency = EUR

  it('derives gross-per-share, EXCLUDING fees+taxes (not amount/shares)', () => {
    // BUY 10 shares, total cash = 1050 EUR = gross 1000 + 30 fee + 20 tax.
    // amount(hecto)=105000, fee=3000, tax=2000. gross=1000 => price 100.00/share.
    seedTrade(db, { uuid: 't1', type: 'BUY', date: '2025-03-14', shares: 10 * 1e8, amountHecto: 105000, currency: 'EUR', feeHecto: 3000, taxHecto: 2000 });
    const r = derivePricesFromTransactions(db, SEC);
    expect(r).toEqual({ written: 1, skipped: 0 });
    expect(readPrice(db, '2025-03-14')?.value).toBe(10000000000); // 100.00 x 1e8
  });

  it('SELL: gross = amount + fees + taxes', () => {
    // SELL 10 shares, cash received 950 = gross 1000 - 30 fee - 20 tax. price 100/share.
    seedTrade(db, { uuid: 't2', type: 'SELL', date: '2025-04-01', shares: 10 * 1e8, amountHecto: 95000, currency: 'EUR', feeHecto: 3000, taxHecto: 2000 });
    const r = derivePricesFromTransactions(db, SEC);
    expect(r.written).toBe(1);
    expect(readPrice(db, '2025-04-01')?.value).toBe(10000000000);
  });

  it('cross-currency BUY uses the security-currency gross from the FOREX unit', () => {
    db.prepare(`UPDATE security SET currency='USD' WHERE uuid=?`).run(SEC);
    // BUY 10 sh, deposit-ccy(EUR) gross 1000 (amount=100000 hecto), FOREX forex_amount = 1100 USD (110000 hecto).
    // security-ccy gross = 1100 USD => price 110 USD/share.
    seedTrade(db, { uuid: 't3', type: 'BUY', date: '2025-05-01', shares: 10 * 1e8, amountHecto: 100000, currency: 'EUR', forexAmountHecto: 110000, forexCurrency: 'USD', rate: '1.1' });
    const r = derivePricesFromTransactions(db, SEC);
    expect(r.written).toBe(1);
    expect(readPrice(db, '2025-05-01')?.value).toBe(11000000000); // 110 x 1e8
  });

  it('overwrites an existing same-date manual quote (PP precedence)', () => {
    upsertPrice(db, SEC, { date: '2025-03-14', value: '999' });
    seedTrade(db, { uuid: 't4', type: 'BUY', date: '2025-03-14', shares: 10 * 1e8, amountHecto: 100000, currency: 'EUR' });
    derivePricesFromTransactions(db, SEC);
    expect(readPrice(db, '2025-03-14')?.value).toBe(10000000000); // 100, not 999
  });

  it('skips + counts a cross-currency trade with no resolvable rate', () => {
    db.prepare(`UPDATE security SET currency='USD' WHERE uuid=?`).run(SEC);
    // EUR trade, no FOREX unit => security-currency gross unresolvable.
    seedTrade(db, { uuid: 't5', type: 'BUY', date: '2025-06-01', shares: 10 * 1e8, amountHecto: 100000, currency: 'EUR' });
    const r = derivePricesFromTransactions(db, SEC);
    expect(r).toEqual({ written: 0, skipped: 1 });
    expect(readPrice(db, '2025-06-01')).toBeUndefined();
  });

  it('ignores the BUY cash-side row (shares=0)', () => {
    seedTrade(db, { uuid: 't6', type: 'BUY', date: '2025-03-14', shares: 10 * 1e8, amountHecto: 100000, currency: 'EUR' });
    // cash-side row (shares=0) — uses the same acc-1 seeded by seedTrade above
    db.prepare(
      `INSERT INTO xact (uuid, type, date, acctype, account, security, shares, amount, currency, updatedAt, _xmlid, _order)
       VALUES ('t6c','BUY','2025-03-14','portfolio','acc-1',?,0,100000,'EUR','2025-01-01T00:00:00',0,0)`,
    ).run(SEC);
    const r = derivePricesFromTransactions(db, SEC);
    expect(r.written).toBe(1); // only the shares>0 leg priced
  });

  it('returns {written:0, skipped:0} when the security has no trades', () => {
    const r = derivePricesFromTransactions(db, SEC);
    expect(r).toEqual({ written: 0, skipped: 0 });
  });

  it('same-date trades: last by _id wins (overwrite)', () => {
    seedTrade(db, { uuid: 'sd1', type: 'BUY', date: '2025-07-01', shares: 10 * 1e8, amountHecto: 100000, currency: 'EUR' }); // 100/sh
    seedTrade(db, { uuid: 'sd2', type: 'BUY', date: '2025-07-01', shares: 10 * 1e8, amountHecto: 120000, currency: 'EUR' }); // 120/sh, inserted later
    const r = derivePricesFromTransactions(db, SEC);
    expect(r.written).toBe(2); // both processed
    expect(readPrice(db, '2025-07-01')?.value).toBe(12000000000); // last (_id-ordered) wins → 120
  });

  it('mixed batch: counts written and skipped independently', () => {
    db.prepare(`UPDATE security SET currency='USD' WHERE uuid=?`).run(SEC);
    // resolvable: cross-ccy BUY with FOREX unit → 110 USD/sh
    seedTrade(db, { uuid: 'mb1', type: 'BUY', date: '2025-08-01', shares: 10 * 1e8, amountHecto: 100000, currency: 'EUR', forexAmountHecto: 110000, forexCurrency: 'USD', rate: '1.1' });
    // unresolvable: EUR trade, no FOREX unit, security is USD
    seedTrade(db, { uuid: 'mb2', type: 'BUY', date: '2025-08-02', shares: 10 * 1e8, amountHecto: 100000, currency: 'EUR' });
    const r = derivePricesFromTransactions(db, SEC);
    expect(r).toEqual({ written: 1, skipped: 1 });
    expect(readPrice(db, '2025-08-01')?.value).toBe(11000000000);
    expect(readPrice(db, '2025-08-02')).toBeUndefined();
  });
});
