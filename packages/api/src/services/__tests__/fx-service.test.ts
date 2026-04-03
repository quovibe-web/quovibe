import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { buildRateMap, getRate } from '../fx.service';
import { getRateFromMap } from '@quovibe/engine';


let db: BetterSqlite3.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    )
  `);
});

describe('buildRateMap — direct pair', () => {
  test('builds forward-filled map from sparse DB data', () => {
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2024-03-15', 'EUR', 'AUD', '1.5693');
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2024-03-18', 'EUR', 'AUD', '1.6263');

    // We want AUD→EUR (multiply convention)
    // EUR→AUD = 1.5693, so AUD→EUR = 1/1.5693
    // buildRateMap(AUD, EUR) should invert
    const map = buildRateMap(db, 'AUD', 'EUR', '2024-03-15', '2024-03-18');

    const fri = getRateFromMap(map, '2024-03-15');
    expect(fri).not.toBeNull();
    // 1/1.5693 ≈ 0.63723
    expect(fri!.toDecimalPlaces(4).toString()).toBe('0.6372');

    // Weekend forward-filled
    const sat = getRateFromMap(map, '2024-03-16');
    expect(sat?.toDecimalPlaces(4).toString()).toBe('0.6372');
  });
});

describe('buildRateMap — inverse pair', () => {
  test('auto-inverts when only reverse pair is in DB', () => {
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2024-03-15', 'EUR', 'USD', '1.0844');

    // Ask for USD→EUR, only EUR→USD in DB
    const map = buildRateMap(db, 'USD', 'EUR', '2024-03-15', '2024-03-15');
    const rate = getRateFromMap(map, '2024-03-15');
    expect(rate).not.toBeNull();
    // 1/1.0844 ≈ 0.9222
    expect(rate!.toDecimalPlaces(4).toString()).toBe('0.9222');
  });
});

describe('buildRateMap — cross-rate triangulation', () => {
  test('triangulates USD→GBP via EUR', () => {
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2024-03-15', 'EUR', 'USD', '1.08');
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2024-03-15', 'EUR', 'GBP', '0.86');

    const map = buildRateMap(db, 'USD', 'GBP', '2024-03-15', '2024-03-15');
    const rate = getRateFromMap(map, '2024-03-15');
    expect(rate).not.toBeNull();
    // USD→GBP = EUR→GBP / EUR→USD = 0.86 / 1.08 ≈ 0.7963
    expect(rate!.toDecimalPlaces(4).toString()).toBe('0.7963');
  });
});

describe('getRate — forward-fill single lookup', () => {
  test('returns closest previous rate for weekend', () => {
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2024-03-15', 'EUR', 'USD', '1.0844');

    const rate = getRate(db, 'EUR', 'USD', '2024-03-17'); // Sunday
    expect(rate?.toString()).toBe('1.0844');
  });

  test('returns null when no data exists', () => {
    const rate = getRate(db, 'EUR', 'JPY', '2024-03-15');
    expect(rate).toBeNull();
  });
});
