import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import {
  getPortfolioBaseCurrency,
  setPortfolioBaseCurrency,
  isValidIso4217,
  PortfolioBaseError,
} from '../portfolio-base.service';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applyBootstrap(db);
  // Remove the meta row so each test controls its own fallback state.
  db.prepare(`DELETE FROM vf_portfolio_meta WHERE key='baseCurrency'`).run();
});

describe('isValidIso4217', () => {
  it.each([
    ['EUR', true],
    ['USD', true],
    ['GBP', true],
    ['eur', false],
    ['EU', false],
    ['EURO', false],
    ['123', false],
    ['', false],
  ])('isValidIso4217(%j) === %s', (code, expected) => {
    expect(isValidIso4217(code)).toBe(expected);
  });
});

describe('getPortfolioBaseCurrency priority chain', () => {
  it('returns vf_portfolio_meta.baseCurrency when present', () => {
    db.prepare("INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency','USD')").run();
    expect(getPortfolioBaseCurrency(db)).toBe('USD');
  });

  it('falls back to first deposit ccy when meta missing', () => {
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, _order, updatedAt, _xmlid)
       VALUES ('a1','Cash','account','GBP',0,0,'2024-01-01',0)`,
    ).run();
    expect(getPortfolioBaseCurrency(db)).toBe('GBP');
  });

  it('falls back to first security ccy when no deposits', () => {
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
       VALUES ('s1','TestSec','JPY',0,'2024-01-01')`,
    ).run();
    expect(getPortfolioBaseCurrency(db)).toBe('JPY');
  });

  it('falls back to EUR literal on truly empty portfolio', () => {
    expect(getPortfolioBaseCurrency(db)).toBe('EUR');
  });
});

describe('setPortfolioBaseCurrency', () => {
  it('writes valid ISO-4217 code', () => {
    setPortfolioBaseCurrency(db, 'CHF');
    expect(getPortfolioBaseCurrency(db)).toBe('CHF');
  });

  it('throws PortfolioBaseError on invalid code', () => {
    expect(() => setPortfolioBaseCurrency(db, 'eur')).toThrow(PortfolioBaseError);
    expect(() => setPortfolioBaseCurrency(db, 'EURO')).toThrow(PortfolioBaseError);
  });

  it('overwrites existing value', () => {
    setPortfolioBaseCurrency(db, 'USD');
    setPortfolioBaseCurrency(db, 'EUR');
    expect(getPortfolioBaseCurrency(db)).toBe('EUR');
  });
});
