// Reference: PP stores user-defined exchange rates as securities carrying a
// targetCurrency; their price series is the rate history. applyBootstrap
// ingests them into vf_exchange_rate so getRate() can resolve pairs the ECB
// feed does not publish.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../apply-bootstrap';

let db: Database.Database;

function seedFxSeries(
  uuid: string,
  currency: string,
  targetCurrency: string,
  prices: Array<{ date: string; value: number }>,
): void {
  db.prepare(
    `INSERT INTO security (uuid, name, currency, targetCurrency, updatedAt)
     VALUES (?, ?, ?, ?, '2026-01-01')`,
  ).run(uuid, `${currency}/${targetCurrency}`, currency, targetCurrency);
  for (const p of prices) {
    db.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(uuid, p.date, p.value);
  }
}

function rateRows(): Array<{
  date: string; from_currency: string; to_currency: string; rate: string; source: string;
}> {
  return db
    .prepare(`SELECT date, from_currency, to_currency, rate, source
                FROM vf_exchange_rate ORDER BY from_currency, to_currency, date`)
    .all() as Array<{
      date: string; from_currency: string; to_currency: string; rate: string; source: string;
    }>;
}

beforeEach(() => {
  db = new Database(':memory:');
  applyBootstrap(db);
});

describe('ingestCustomExchangeRateSeries', () => {
  it('copies a targetCurrency security price series into vf_exchange_rate', () => {
    // HUF/CHF ≈ 0.0031 CHF per 1 HUF → stored ×1e8 in `price`.
    seedFxSeries('fx-huf-chf', 'HUF', 'CHF', [
      { date: '2026-04-28', value: 310_000 },
      { date: '2026-04-29', value: 312_000 },
    ]);

    applyBootstrap(db);

    expect(rateRows()).toEqual([
      { date: '2026-04-28', from_currency: 'HUF', to_currency: 'CHF', rate: '0.00310000', source: 'IMPORT' },
      { date: '2026-04-29', from_currency: 'HUF', to_currency: 'CHF', rate: '0.00312000', source: 'IMPORT' },
    ]);
  });

  it('ignores securities without a targetCurrency', () => {
    db.prepare(
      `INSERT INTO security (uuid, name, currency, updatedAt)
       VALUES ('sec-1', 'Nestle', 'CHF', '2026-01-01')`,
    ).run();
    db.prepare(`INSERT INTO price (security, tstamp, value) VALUES ('sec-1','2026-04-29', 9_000_000_000)`).run();

    applyBootstrap(db);

    expect(rateRows()).toHaveLength(0);
  });

  it('ignores a series whose targetCurrency equals its own currency', () => {
    seedFxSeries('fx-noop', 'HUF', 'HUF', [{ date: '2026-04-29', value: 100_000_000 }]);

    applyBootstrap(db);

    expect(rateRows()).toHaveLength(0);
  });

  it('strips a time tail from the price timestamp', () => {
    seedFxSeries('fx-huf-usd', 'HUF', 'USD', [
      { date: '2026-04-29T17:30:00', value: 290_000 },
    ]);

    applyBootstrap(db);

    expect(rateRows()[0]?.date).toBe('2026-04-29');
  });

  it('keeps the last quote of the day when a series has several same-day rows', () => {
    seedFxSeries('fx-huf-usd', 'HUF', 'USD', [
      { date: '2026-04-29T09:00:00', value: 290_000 },
      { date: '2026-04-29T17:30:00', value: 295_000 },
    ]);

    applyBootstrap(db);

    expect(rateRows()).toEqual([
      { date: '2026-04-29', from_currency: 'HUF', to_currency: 'USD', rate: '0.00295000', source: 'IMPORT' },
    ]);
  });

  it('never overwrites a MANUAL rate', () => {
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
       VALUES ('2026-04-29','HUF','CHF','0.99','MANUAL')`,
    ).run();
    seedFxSeries('fx-huf-chf', 'HUF', 'CHF', [{ date: '2026-04-29', value: 310_000 }]);

    applyBootstrap(db);

    expect(rateRows()).toEqual([
      { date: '2026-04-29', from_currency: 'HUF', to_currency: 'CHF', rate: '0.99', source: 'MANUAL' },
    ]);
  });

  it('overwrites an auto-fetched ECB rate — the user series is authoritative', () => {
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
       VALUES ('2026-04-29','HUF','CHF','0.99','ECB')`,
    ).run();
    seedFxSeries('fx-huf-chf', 'HUF', 'CHF', [{ date: '2026-04-29', value: 310_000 }]);

    applyBootstrap(db);

    expect(rateRows()).toEqual([
      { date: '2026-04-29', from_currency: 'HUF', to_currency: 'CHF', rate: '0.00310000', source: 'IMPORT' },
    ]);
  });

  it('is idempotent across repeated bootstraps', () => {
    seedFxSeries('fx-huf-chf', 'HUF', 'CHF', [{ date: '2026-04-29', value: 310_000 }]);

    applyBootstrap(db);
    applyBootstrap(db);
    applyBootstrap(db);

    expect(rateRows()).toEqual([
      { date: '2026-04-29', from_currency: 'HUF', to_currency: 'CHF', rate: '0.00310000', source: 'IMPORT' },
    ]);
  });

  it('runs before the cross-currency backfill so one bootstrap pass decorates the trade', () => {
    seedFxSeries('fx-huf-chf', 'HUF', 'CHF', [{ date: '2026-04-29', value: 310_000 }]);
    db.prepare(
      `INSERT INTO security (uuid, name, currency, updatedAt)
       VALUES ('sec-nesn', 'Nestle', 'CHF', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO account (uuid, type, name, currency, updatedAt, _xmlid, _order)
       VALUES ('acc-1', 'portfolio', 'Broker', 'HUF', '2026-01-01', 1, 1)`,
    ).run();
    // Deposit-currency (HUF) BUY of a CHF security, with no FX-decorated unit.
    db.prepare(
      `INSERT INTO xact (uuid, account, type, date, currency, amount, shares, security,
                         acctype, updatedAt, _xmlid, _order)
       VALUES ('x-1', 'acc-1', 'BUY', '2026-04-29', 'HUF', 1000000, 100000000, 'sec-nesn',
               'portfolio', '2026-04-29', 1, 1)`,
    ).run();

    applyBootstrap(db);

    const unit = db
      .prepare(`SELECT type, currency, forex_currency, forex_amount, exchangeRate
                  FROM xact_unit WHERE xact = 'x-1'`)
      .get() as {
        type: string; currency: string; forex_currency: string;
        forex_amount: number; exchangeRate: string;
      } | undefined;

    expect(unit).toBeDefined();
    expect(unit?.type).toBe('GROSS_VALUE');
    expect(unit?.currency).toBe('HUF');
    expect(unit?.forex_currency).toBe('CHF');
    // 1 000 000 hecto-HUF × 0.0031 = 3100 hecto-CHF
    expect(unit?.forex_amount).toBe(3100);
    expect(unit?.exchangeRate).toBe('0.0031');
  });
});
