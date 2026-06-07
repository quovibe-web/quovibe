import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { upsertPrice, editPrice, deletePrices, deleteAllPrices } from '../manual-prices.service';

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
