// Reference: fx-rates service — CRUD for user-entered MANUAL FX rates + ECB CSV bulk import
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import {
  listFxPairs, listFxRatesForPair,
  createFxRate, updateFxRate, deleteFxRate,
  importEcbRates,
  FxRatesError,
} from '../fx-rates.service';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  applyBootstrap(db);
});

describe('listFxPairs', () => {
  it('returns distinct pairs with counts + date ranges', () => {
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source) VALUES
                ('2026-01-01','EUR','USD','1.10','ECB'),
                ('2026-01-02','EUR','USD','1.11','ECB'),
                ('2026-01-01','EUR','GBP','0.85','ECB')`).run();
    const pairs = listFxPairs(db);
    expect(pairs).toHaveLength(2);
    const usdPair = pairs.find((p) => p.to === 'USD');
    expect(usdPair?.count).toBe(2);
    expect(usdPair?.minDate).toBe('2026-01-01');
    expect(usdPair?.maxDate).toBe('2026-01-02');
  });

  it('returns empty array when no rates exist', () => {
    expect(listFxPairs(db)).toEqual([]);
  });
});

describe('listFxRatesForPair', () => {
  it('returns rates sorted descending by date', () => {
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source) VALUES
                ('2026-01-01','EUR','USD','1.10','ECB'),
                ('2026-01-03','EUR','USD','1.12','MANUAL'),
                ('2026-01-02','EUR','USD','1.11','ECB')`).run();
    const rates = listFxRatesForPair(db, 'EUR', 'USD');
    expect(rates).toHaveLength(3);
    expect(rates[0].date).toBe('2026-01-03');
    expect(rates[0].source).toBe('MANUAL');
  });

  it('returns empty for unknown pair', () => {
    expect(listFxRatesForPair(db, 'EUR', 'JPY')).toEqual([]);
  });

  it('throws on invalid currency code', () => {
    expect(() => listFxRatesForPair(db, 'EU', 'USD')).toThrow(FxRatesError);
  });
});

describe('createFxRate', () => {
  it('inserts row with source=MANUAL', () => {
    const row = createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' });
    expect(row.source).toBe('MANUAL');
    expect(row.rate).toBe('1.10');
    expect(row.date).toBe('2026-01-01');
  });

  it('throws DUPLICATE_RATE on PK collision', () => {
    createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' });
    expect(() => createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.11' }))
      .toThrow(FxRatesError);
    try {
      createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.11' });
    } catch (e) {
      expect((e as FxRatesError).code).toBe('DUPLICATE_RATE');
    }
  });

  it('rejects invalid ISO-4217 codes', () => {
    expect(() => createFxRate(db, { from: 'EU', to: 'USD', date: '2026-01-01', rate: '1.10' }))
      .toThrow(FxRatesError);
    expect(() => createFxRate(db, { from: 'EUR', to: 'us', date: '2026-01-01', rate: '1.10' }))
      .toThrow(FxRatesError);
  });

  it('rejects same currency (from === to)', () => {
    expect(() => createFxRate(db, { from: 'EUR', to: 'EUR', date: '2026-01-01', rate: '1.0' }))
      .toThrow(FxRatesError);
  });

  it('rejects non-positive rates', () => {
    expect(() => createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '0' }))
      .toThrow(FxRatesError);
    expect(() => createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '-1' }))
      .toThrow(FxRatesError);
    expect(() => createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: 'abc' }))
      .toThrow(FxRatesError);
  });
});

describe('updateFxRate', () => {
  it('updates only MANUAL rows', () => {
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
                VALUES ('2026-01-01','EUR','USD','1.10','ECB')`).run();
    expect(() => updateFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.20' }))
      .toThrow(FxRatesError);
    const row = db.prepare(`SELECT rate FROM vf_exchange_rate`).get() as { rate: string };
    expect(row.rate).toBe('1.10');
  });

  it('updates MANUAL row successfully', () => {
    createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' });
    const row = updateFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.25' });
    expect(row.rate).toBe('1.25');
    const stored = db.prepare(`SELECT rate FROM vf_exchange_rate`).get() as { rate: string };
    expect(stored.rate).toBe('1.25');
  });
});

describe('deleteFxRate', () => {
  it('deletes only MANUAL rows', () => {
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
                VALUES ('2026-01-01','EUR','USD','1.10','ECB')`).run();
    expect(() => deleteFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01' }))
      .toThrow(FxRatesError);
  });

  it('deletes MANUAL row successfully', () => {
    createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' });
    deleteFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01' });
    expect(listFxRatesForPair(db, 'EUR', 'USD')).toEqual([]);
  });
});

describe('importEcbRates', () => {
  it('bulk inserts with source=IMPORT', () => {
    const result = importEcbRates(db, [
      { date: '2026-01-01', from: 'EUR', to: 'USD', rate: '1.10' },
      { date: '2026-01-02', from: 'EUR', to: 'USD', rate: '1.11' },
    ]);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
    const rates = listFxRatesForPair(db, 'EUR', 'USD');
    expect(rates).toHaveLength(2);
    expect(rates[0].source).toBe('IMPORT');
  });

  it('skips PK conflicts (INSERT OR IGNORE)', () => {
    createFxRate(db, { from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' });
    const result = importEcbRates(db, [
      { date: '2026-01-01', from: 'EUR', to: 'USD', rate: '9.99' },
      { date: '2026-01-02', from: 'EUR', to: 'USD', rate: '1.11' },
    ]);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    // Manual row preserved untouched
    const row = db.prepare(`SELECT rate, source FROM vf_exchange_rate WHERE date='2026-01-01'`).get() as { rate: string; source: string };
    expect(row.rate).toBe('1.10');
    expect(row.source).toBe('MANUAL');
  });
});
