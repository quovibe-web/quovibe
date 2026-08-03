// Reference: on a fresh PP-XML import the cross-currency GROSS_VALUE backfill
// runs inside applyBootstrap, which always precedes the first FX fetch — so it
// finds an empty rate cache and decorates nothing. The scheduler re-runs it
// once rates have actually landed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';

const { fetchAllExchangeRates } = vi.hoisted(() => ({ fetchAllExchangeRates: vi.fn() }));

vi.mock('../fx-fetcher.service', () => ({ fetchAllExchangeRates }));

import { startFxScheduler, stopFxScheduler, _resetEagerForTests } from '../fx-scheduler.service';

let db: Database.Database;
const PORTFOLIO_ID = 'p-fx-backfill';

/** A HUF-deposit BUY of a CHF security, carrying no FX-decorated unit. */
function seedCrossCurrencyTrade(): void {
  db.prepare(
    `INSERT INTO account (uuid, type, name, currency, updatedAt, _xmlid, _order)
     VALUES ('acc-1', 'portfolio', 'Broker', 'HUF', '2026-01-01', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO security (uuid, name, currency, updatedAt)
     VALUES ('sec-nesn', 'Nestle', 'CHF', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO xact (uuid, account, type, date, currency, amount, shares, security,
                       acctype, updatedAt, _xmlid, _order)
     VALUES ('x-1', 'acc-1', 'BUY', '2026-04-29', 'HUF', 1000000, 100000000, 'sec-nesn',
             'portfolio', '2026-04-29', 1, 1)`,
  ).run();
}

function decoratedUnitCount(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM xact_unit WHERE xact = 'x-1'`)
    .get() as { n: number };
  return row.n;
}

beforeEach(() => {
  db = new Database(':memory:');
  applyBootstrap(db);
  seedCrossCurrencyTrade();
  fetchAllExchangeRates.mockReset();
  _resetEagerForTests();
});

afterEach(() => {
  stopFxScheduler(PORTFOLIO_ID);
  db.close();
});

describe('FX scheduler — backfill after fetch', () => {
  it('decorates cross-currency trades once the eager fetch lands rates', async () => {
    expect(decoratedUnitCount()).toBe(0);

    fetchAllExchangeRates.mockImplementation((sqlite: Database.Database) => {
      sqlite
        .prepare(
          `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
           VALUES ('2026-04-29','HUF','CHF','0.0031','ECB')`,
        )
        .run();
      return Promise.resolve({ results: [], totalFetched: 1, duration: 1 });
    });

    startFxScheduler(PORTFOLIO_ID, db);
    await vi.waitFor(() => expect(decoratedUnitCount()).toBe(1));

    const unit = db
      .prepare(`SELECT forex_currency, forex_amount FROM xact_unit WHERE xact = 'x-1'`)
      .get() as { forex_currency: string; forex_amount: number };
    expect(unit.forex_currency).toBe('CHF');
    expect(unit.forex_amount).toBe(3100);
  });

  it('does not throw when the fetch resolves with nothing to backfill', async () => {
    fetchAllExchangeRates.mockResolvedValue({ results: [], totalFetched: 0, duration: 1 });

    startFxScheduler(PORTFOLIO_ID, db);
    await vi.waitFor(() => expect(fetchAllExchangeRates).toHaveBeenCalledTimes(1));

    expect(decoratedUnitCount()).toBe(0);
  });

  it('survives a failing fetch without unhandled rejection', async () => {
    fetchAllExchangeRates.mockRejectedValue(new Error('ECB unreachable'));

    startFxScheduler(PORTFOLIO_ID, db);
    await vi.waitFor(() => expect(fetchAllExchangeRates).toHaveBeenCalledTimes(1));

    expect(decoratedUnitCount()).toBe(0);
  });
});
