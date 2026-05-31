import { describe, test, expect, beforeEach, it } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { buildRateMap, getRate } from '../fx.service';
import { getRateFromMap } from '@quovibe/engine';
import { applyBootstrap } from '../../db/apply-bootstrap';


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
    expect(fri!.toFixed(4)).toBe('0.6372');

    // Weekend forward-filled
    const sat = getRateFromMap(map, '2024-03-16');
    expect(sat?.toFixed(4)).toBe('0.6372');
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
    expect(rate!.toFixed(4)).toBe('0.9222');
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
    expect(rate!.toFixed(4)).toBe('0.7963');
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

describe('getRate — EUR triangulation', () => {
  it('triangulates USD→GBP via EUR when no direct pair exists', () => {
    const db = newDb();
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
                VALUES ('2025-09-12', 'EUR', 'USD', '1.08')`).run();
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
                VALUES ('2025-09-12', 'EUR', 'GBP', '0.86')`).run();
    const rate = getRate(db, 'USD', 'GBP', '2025-09-12');
    // USD→GBP = (EUR→GBP) / (EUR→USD) = 0.86 / 1.08 = 0.796296...
    expect(rate?.toFixed(6)).toBe('0.796296');
  });

  it('prefers direct pair over triangulation when both exist', () => {
    const db = newDb();
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
                VALUES ('2025-09-12', 'EUR', 'USD', '1.08')`).run();
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
                VALUES ('2025-09-12', 'EUR', 'GBP', '0.86')`).run();
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
                VALUES ('2025-09-12', 'USD', 'GBP', '0.80')`).run();
    const rate = getRate(db, 'USD', 'GBP', '2025-09-12');
    expect(rate?.toFixed(2)).toBe('0.80');
  });

  it('returns null when neither direct, inverse, nor triangulation possible', () => {
    const db = newDb();
    const rate = getRate(db, 'USD', 'GBP', '2025-09-12');
    expect(rate).toBeNull();
  });
});

describe('buildRateMap — merge across direct/inverse/triangulation', () => {
  it('single late MANUAL direct row does not orphan the inverse-pair cache', () => {
    // Scenario: user resolved an unresolved-FX via UnresolvedFxModal at "today"
    // by adding a MANUAL USD→EUR row. The ECB cache holds 2 EUR→USD rows at
    // earlier dates. Pre-fix, buildRateMap short-circuited on the non-empty
    // direct query and forward-fill from a single late date produced empty
    // coverage for prior dates → marketValueBase=0 for trades before the
    // manual rate's date.
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE vf_exchange_rate (
        date TEXT NOT NULL,
        from_currency TEXT NOT NULL,
        to_currency TEXT NOT NULL,
        rate TEXT NOT NULL,
        PRIMARY KEY (date, from_currency, to_currency)
      )
    `);
    // ECB inverse direction — covers the historical period
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2024-08-20', 'EUR', 'USD', '1.10');
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2025-03-17', 'EUR', 'USD', '1.09');
    // Late MANUAL direct row at period end
    db.prepare('INSERT INTO vf_exchange_rate VALUES (?, ?, ?, ?)').run('2026-05-20', 'USD', 'EUR', '0.9050');

    const map = buildRateMap(db, 'USD', 'EUR', '2024-08-20', '2026-05-20');

    // Historical dates must resolve via inverse path (1/1.10 ≈ 0.9091)
    const earlyRate = getRateFromMap(map, '2024-08-20');
    expect(earlyRate).not.toBeNull();
    expect(earlyRate!.toFixed(4)).toBe('0.9091');

    // Mid-period date covered by second inverse row (1/1.09 ≈ 0.9174)
    const midRate = getRateFromMap(map, '2025-03-17');
    expect(midRate).not.toBeNull();
    expect(midRate!.toFixed(4)).toBe('0.9174');

    // Period-end date wins by direct (highest precedence)
    const endRate = getRateFromMap(map, '2026-05-20');
    expect(endRate).not.toBeNull();
    expect(endRate!.toFixed(4)).toBe('0.9050');
  });
});

function newDb(): BetterSqlite3.Database {
  const db = new Database(':memory:');
  applyBootstrap(db);
  return db;
}
