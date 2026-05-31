// Reference: vf_exchange_rate.source column — MANUAL row protection for user-entered FX rates
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../apply-bootstrap';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  applyBootstrap(db);
});

describe('vf_exchange_rate.source patch', () => {
  it('column installed with default ECB', () => {
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
                VALUES ('2026-01-01','EUR','USD','1.10')`).run();
    const row = db.prepare(`SELECT source FROM vf_exchange_rate`).get() as { source: string };
    expect(row.source).toBe('ECB');
  });

  it('accepts MANUAL value', () => {
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
                VALUES ('2026-01-01','EUR','USD','1.10','MANUAL')`).run();
    const row = db.prepare(`SELECT source FROM vf_exchange_rate`).get() as { source: string };
    expect(row.source).toBe('MANUAL');
  });

  it('accepts IMPORT value', () => {
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
                VALUES ('2026-01-01','EUR','USD','1.10','IMPORT')`).run();
    const row = db.prepare(`SELECT source FROM vf_exchange_rate`).get() as { source: string };
    expect(row.source).toBe('IMPORT');
  });

  it('re-applying bootstrap is idempotent', () => {
    applyBootstrap(db);
    applyBootstrap(db);
    // No throw = success.
    expect(true).toBe(true);
  });

  it('ECB writer (saveRates SQL) does not overwrite MANUAL rows', () => {
    // Insert a MANUAL rate
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
                VALUES ('2026-01-01','EUR','USD','1.10','MANUAL')`).run();

    // Simulate the ECB writer's UPSERT with a different rate — must not overwrite MANUAL
    db.prepare(`
      INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
      VALUES (?, ?, ?, ?, 'ECB')
      ON CONFLICT(date, from_currency, to_currency) DO UPDATE SET
        rate = excluded.rate,
        source = excluded.source
      WHERE source != 'MANUAL'
    `).run('2026-01-01', 'EUR', 'USD', '1.25');

    const row = db.prepare(`SELECT rate, source FROM vf_exchange_rate WHERE date='2026-01-01'`).get() as { rate: string; source: string };
    expect(row.rate).toBe('1.10');
    expect(row.source).toBe('MANUAL');
  });

  it('ECB writer (saveRates SQL) does overwrite ECB rows', () => {
    // Insert an ECB rate first
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
                VALUES ('2026-01-01','EUR','USD','1.10','ECB')`).run();

    // Simulate the ECB writer updating it
    db.prepare(`
      INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
      VALUES (?, ?, ?, ?, 'ECB')
      ON CONFLICT(date, from_currency, to_currency) DO UPDATE SET
        rate = excluded.rate,
        source = excluded.source
      WHERE source != 'MANUAL'
    `).run('2026-01-01', 'EUR', 'USD', '1.25');

    const row = db.prepare(`SELECT rate, source FROM vf_exchange_rate WHERE date='2026-01-01'`).get() as { rate: string; source: string };
    expect(row.rate).toBe('1.25');
    expect(row.source).toBe('ECB');
  });
});
