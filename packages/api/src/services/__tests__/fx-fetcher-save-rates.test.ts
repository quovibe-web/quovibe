// Reference: vf_exchange_rate write precedence — the auto-fetch writer must
// never clobber user-supplied rates (MANUAL entries, uploaded ECB CSVs, or
// exchange-rate series ingested from a PP-XML import).
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Decimal from 'decimal.js';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { saveRates } from '../fx-fetcher.service';

let db: Database.Database;

function seed(rate: string, source: string): void {
  db.prepare(
    `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
     VALUES ('2026-04-29','HUF','CHF',?,?)`,
  ).run(rate, source);
}

function read(): { rate: string; source: string } {
  return db
    .prepare(`SELECT rate, source FROM vf_exchange_rate WHERE date='2026-04-29'`)
    .get() as { rate: string; source: string };
}

beforeEach(() => {
  db = new Database(':memory:');
  applyBootstrap(db);
});

describe('saveRates write precedence', () => {
  it('overwrites an ECB row', () => {
    seed('0.0099', 'ECB');

    saveRates(db, 'HUF', 'CHF', [{ date: '2026-04-29', rate: new Decimal('0.0031') }]);

    expect(read()).toEqual({ rate: '0.0031', source: 'ECB' });
  });

  it('never overwrites a MANUAL row', () => {
    seed('0.0099', 'MANUAL');

    saveRates(db, 'HUF', 'CHF', [{ date: '2026-04-29', rate: new Decimal('0.0031') }]);

    expect(read()).toEqual({ rate: '0.0099', source: 'MANUAL' });
  });

  it('never overwrites an IMPORT row — a user-curated series outranks the feed', () => {
    seed('0.0099', 'IMPORT');

    saveRates(db, 'HUF', 'CHF', [{ date: '2026-04-29', rate: new Decimal('0.0031') }]);

    expect(read()).toEqual({ rate: '0.0099', source: 'IMPORT' });
  });

  it('inserts a pair the cache does not hold yet', () => {
    saveRates(db, 'HUF', 'CHF', [{ date: '2026-04-29', rate: new Decimal('0.0031') }]);

    expect(read()).toEqual({ rate: '0.0031', source: 'ECB' });
  });
});
