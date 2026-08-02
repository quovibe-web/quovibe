import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { previewStockSplit, applyStockSplit, StockSplitError } from '../stock-split.service';

const SEC = '11111111-1111-4111-8111-111111111111';
const ACC = '22222222-2222-4222-8222-222222222222';
const EX_DATE = '2026-07-16';

// 1-for-25 reverse split
const REVERSE = {
  securityId: SEC,
  exDate: EX_DATE,
  newShares: 1,
  oldShares: 25,
  changeTransactions: true,
  changeHistoricalQuotes: true,
};

const withFlags = (overrides: Partial<typeof REVERSE> = {}): typeof REVERSE => ({
  ...REVERSE,
  ...overrides,
});

let orderSeq = 0; // native-ok

function freshDb(): Database.Database {
  orderSeq = 0; // native-ok
  const db = new Database(':memory:');
  applyBootstrap(db);
  db.prepare(
    `INSERT INTO security (uuid, name, currency, updatedAt) VALUES (?, 'Amper', 'EUR', '2026-01-01T00:00:00')`,
  ).run(SEC);
  db.prepare(
    `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
     VALUES (?, 'Main Securities', 'portfolio', 'EUR', 0, '2026-01-01T00:00:00', 0, 0)`,
  ).run(ACC);
  return db;
}

function insertTx(
  db: Database.Database,
  uuid: string,
  date: string,
  type: string,
  sharesDb: number,
  opts: { source?: string; amount?: number } = {},
): void {
  db.prepare(
    `INSERT INTO xact (uuid, acctype, account, security, date, type, shares, amount, currency, source, updatedAt, _xmlid, _order)
     VALUES (?, 'portfolio', ?, ?, ?, ?, ?, ?, 'EUR', ?, '2026-01-01T00:00:00', 0, ?)`,
  ).run(
    uuid,
    ACC,
    SEC,
    date,
    type,
    sharesDb,
    opts.amount ?? 0,
    opts.source ?? null,
    orderSeq++, // native-ok
  );
}

function insertPrice(
  db: Database.Database,
  tstamp: string,
  value: number,
  ohl?: { open: number; high: number; low: number; volume: number },
): void {
  db.prepare(
    `INSERT INTO price (security, tstamp, value, open, high, low, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(SEC, tstamp, value, ohl?.open ?? null, ohl?.high ?? null, ohl?.low ?? null, ohl?.volume ?? null);
}

function shares(db: Database.Database, uuid: string): number {
  return (db.prepare(`SELECT shares FROM xact WHERE uuid = ?`).get(uuid) as { shares: number }).shares;
}

function priceRow(
  db: Database.Database,
  tstamp: string,
): { value: number; open: number | null; high: number | null; low: number | null; volume: number | null } {
  return db
    .prepare(`SELECT value, open, high, low, volume FROM price WHERE security = ? AND tstamp = ?`)
    .get(SEC, tstamp) as {
    value: number;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
  };
}

function eventCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM security_event`).get() as { n: number }).n;
}

describe('previewStockSplit', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('lists only rows strictly before the ex-date', () => {
    insertTx(db, 'tx-before', '2026-07-15', 'BUY', 250 * 1e8);
    insertTx(db, 'tx-on', EX_DATE, 'BUY', 250 * 1e8);
    insertTx(db, 'tx-after', '2026-07-17', 'BUY', 250 * 1e8);

    const preview = previewStockSplit(db, withFlags());
    expect(preview.transactions.map((t) => t.uuid)).toEqual(['tx-before']);
    expect(preview.counts.transactions).toBe(1);
  });

  it('computes the new share count and carries the account name', () => {
    insertTx(db, 'tx-1', '2026-07-15', 'BUY', 250 * 1e8);
    const [row] = previewStockSplit(db, withFlags()).transactions;
    expect(row.sharesOld).toBe(250 * 1e8);
    expect(row.sharesNew).toBe(10 * 1e8);
    expect(row.accountName).toBe('Main Securities');
  });

  it('treats a date carrying an ISO time tail as day-granular', () => {
    insertTx(db, 'tx-tail', '2026-07-15T15:48:00', 'BUY', 250 * 1e8);
    insertTx(db, 'tx-exday-tail', `${EX_DATE}T09:00:00`, 'BUY', 250 * 1e8);
    expect(previewStockSplit(db, withFlags()).transactions.map((t) => t.uuid)).toEqual(['tx-tail']);
  });

  it('omits rows whose share count does not move', () => {
    // Cash-side rows of a BUY/SELL pair carry shares = 0.
    insertTx(db, 'tx-cash', '2026-07-15', 'BUY', 0);
    const preview = previewStockSplit(db, withFlags());
    expect(preview.transactions).toHaveLength(0);
    expect(preview.warnings).toContain('NO_ROWS_AFFECTED');
  });

  it('applies no transaction-type filter', () => {
    insertTx(db, 'tx-div', '2026-07-15', 'DIVIDENDS', 100 * 1e8);
    expect(previewStockSplit(db, withFlags()).transactions.map((t) => t.uuid)).toEqual(['tx-div']);
  });

  it('previews quotes moving inversely to the ratio', () => {
    insertPrice(db, '2026-07-15', 400000000); // 4.00
    const [q] = previewStockSplit(db, withFlags()).quotes;
    expect(q.valueOld).toBe(400000000);
    expect(q.valueNew).toBe(10000000000); // 100.00
  });

  it('warns when the ex-date is in the future', () => {
    const future = withFlags({ exDate: '2999-01-01' });
    expect(previewStockSplit(db, future).warnings).toContain('FUTURE_EX_DATE');
  });

  it('writes nothing', () => {
    insertTx(db, 'tx-1', '2026-07-15', 'BUY', 250 * 1e8);
    previewStockSplit(db, withFlags());
    expect(shares(db, 'tx-1')).toBe(250 * 1e8);
    expect(eventCount(db)).toBe(0);
  });

  it('throws SECURITY_NOT_FOUND for an unknown security', () => {
    expect(() => previewStockSplit(db, withFlags({ securityId: 'nope' }))).toThrow(StockSplitError);
  });
});

describe('applyStockSplit', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('rewrites shares before the ex-date and leaves the rest alone', () => {
    insertTx(db, 'tx-before', '2026-07-15', 'BUY', 250 * 1e8);
    insertTx(db, 'tx-on', EX_DATE, 'BUY', 250 * 1e8);

    const result = applyStockSplit(db, withFlags());
    expect(result.applied.transactions).toBe(1);
    expect(shares(db, 'tx-before')).toBe(10 * 1e8);
    expect(shares(db, 'tx-on')).toBe(250 * 1e8);
  });

  it('rescales value plus open/high/low but never volume', () => {
    insertPrice(db, '2026-07-15', 400000000, {
      open: 380000000,
      high: 420000000,
      low: 370000000,
      volume: 1500,
    });
    applyStockSplit(db, withFlags());
    const row = priceRow(db, '2026-07-15');
    expect(row.value).toBe(10000000000); // 4.00 -> 100.00
    expect(row.open).toBe(9500000000);
    expect(row.high).toBe(10500000000);
    expect(row.low).toBe(9250000000);
    expect(row.volume).toBe(1500);
  });

  it('passes NULL OHLC through untouched', () => {
    insertPrice(db, '2026-07-15', 400000000);
    applyStockSplit(db, withFlags());
    const row = priceRow(db, '2026-07-15');
    expect(row.open).toBeNull();
    expect(row.high).toBeNull();
  });

  it('re-syncs latest_price from the post-rewrite global max', () => {
    insertPrice(db, '2026-07-14', 300000000);
    insertPrice(db, '2026-07-15', 400000000);
    applyStockSplit(db, withFlags());
    const lp = db.prepare(`SELECT tstamp, value FROM latest_price WHERE security = ?`).get(SEC) as {
      tstamp: string;
      value: number;
    };
    expect(lp.tstamp).toBe('2026-07-15');
    expect(lp.value).toBe(10000000000);
  });

  it('records the event marker in new:old form', () => {
    applyStockSplit(db, withFlags());
    const ev = db
      .prepare(`SELECT security, date, type, details FROM security_event WHERE security = ?`)
      .get(SEC) as { security: string; date: string; type: string; details: string };
    expect(ev.type).toBe('STOCK_SPLIT');
    expect(ev.date).toBe(EX_DATE);
    expect(ev.details).toBe('1:25');
  });

  it('writes only the marker when both flags are false', () => {
    insertTx(db, 'tx-1', '2026-07-15', 'BUY', 250 * 1e8);
    insertPrice(db, '2026-07-15', 400000000);

    const result = applyStockSplit(
      db,
      withFlags({ changeTransactions: false, changeHistoricalQuotes: false }),
    );
    expect(result.applied).toEqual({ transactions: 0, quotes: 0 });
    expect(shares(db, 'tx-1')).toBe(250 * 1e8);
    expect(priceRow(db, '2026-07-15').value).toBe(400000000);
    expect(eventCount(db)).toBe(1);
  });

  it('rejects an identical repeat with DUPLICATE_SPLIT and does not apply twice', () => {
    insertTx(db, 'tx-1', '2026-07-15', 'BUY', 250 * 1e8);
    applyStockSplit(db, withFlags());
    expect(() => applyStockSplit(db, withFlags())).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_SPLIT' }),
    );
    expect(shares(db, 'tx-1')).toBe(10 * 1e8);
    expect(eventCount(db)).toBe(1);
  });

  it('round-trips back to the original counts under the inverted ratio', () => {
    insertTx(db, 'tx-1', '2026-07-15', 'BUY', 250 * 1e8);
    insertPrice(db, '2026-07-15', 400000000);

    applyStockSplit(db, withFlags());
    applyStockSplit(db, withFlags({ newShares: 25, oldShares: 1 }));

    expect(shares(db, 'tx-1')).toBe(250 * 1e8);
    expect(priceRow(db, '2026-07-15').value).toBe(400000000);
    expect(eventCount(db)).toBe(2); // undo leaves its own marker
  });

  it('rolls the whole rewrite back when the imported-row natural key collides', () => {
    // Two imported rows differing only by share count. Under a 1:25 split both
    // land on the same value, colliding on the partial unique index.
    insertTx(db, 'csv-a', '2026-07-15', 'BUY', 250 * 1e8, { source: 'CSV_IMPORT', amount: 1000 });
    insertTx(db, 'csv-b', '2026-07-15', 'BUY', 250 * 1e8 + 1, {
      source: 'CSV_IMPORT',
      amount: 1000,
    });

    expect(() => applyStockSplit(db, withFlags())).toThrow(
      expect.objectContaining({ code: 'SPLIT_DEDUPE_CONFLICT' }),
    );
    // Nothing partially applied, no marker written.
    expect(shares(db, 'csv-a')).toBe(250 * 1e8);
    expect(shares(db, 'csv-b')).toBe(250 * 1e8 + 1);
    expect(eventCount(db)).toBe(0);
  });

  it('throws SECURITY_NOT_FOUND for an unknown security', () => {
    expect(() => applyStockSplit(db, withFlags({ securityId: 'nope' }))).toThrow(
      expect.objectContaining({ code: 'SECURITY_NOT_FOUND' }),
    );
  });
});
