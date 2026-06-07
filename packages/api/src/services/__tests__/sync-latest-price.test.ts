import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { syncLatestPriceFromGlobalMax } from '../prices.service';

function seedSecurity(db: Database.Database, uuid: string): void {
  db.prepare(
    `INSERT INTO security (uuid, name, currency, updatedAt) VALUES (?, ?, 'EUR', '2025-01-01')`,
  ).run(uuid, 'Test Sec');
}

describe('syncLatestPriceFromGlobalMax', () => {
  let db: Database.Database;
  const SEC = 'sec-1';

  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);
    seedSecurity(db, SEC);
  });

  it('sets latest_price to the global max-date row', () => {
    db.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, '2025-01-01', 100), (?, '2025-02-01', 200)`).run(SEC, SEC);
    syncLatestPriceFromGlobalMax(db, SEC);
    const lp = db.prepare(`SELECT tstamp, value FROM latest_price WHERE security = ?`).get(SEC) as { tstamp: string; value: number };
    expect(lp.tstamp).toBe('2025-02-01');
    expect(lp.value).toBe(200);
  });

  it('clears latest_price when no price rows remain', () => {
    db.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, '2025-02-01', 200)`).run(SEC);
    syncLatestPriceFromGlobalMax(db, SEC); // price table empty
    const lp = db.prepare(`SELECT * FROM latest_price WHERE security = ?`).get(SEC);
    expect(lp).toBeUndefined();
  });
});
