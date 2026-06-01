// Regression: rebalancing suggested share count for a foreign-currency security.
//
// `getStatementOfAssets` emits a security entry whose `pricePerShare` is the
// instrument's NATIVE quote (intentional — display parity with broker UIs) while
// `marketValue` is base-converted. The rebalance amount is computed in base
// currency, so dividing it by the native quote inflates/deflates the share count
// by the FX rate. The correct divisor is the base-denominated price per share
// (`marketValue / shares`). Same-currency positions are unaffected.

import { describe, it, expect, beforeEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { computeRebalancing } from '../rebalancing.service';
import { createTestDb, shares, euros, price } from './test-fixtures';

const DATE = '2025-06-01';
const PORT = 'acc-securities';

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = createTestDb();
  // getReferenceData reads logo attribute tables that the shared fixture omits.
  db.exec(`
    CREATE TABLE security_attr (security TEXT, attr_uuid TEXT, value TEXT);
    CREATE TABLE account_attr  (account  TEXT, attr_uuid TEXT, value TEXT);
  `);
});

function insertSecuritiesAccount(): void {
  // Securities-side account only: keeps each holding's market value free of an
  // unmatched cash leg, so the portfolio total equals the security's value.
  db.prepare(
    `INSERT INTO account (uuid, name, type, currency) VALUES (?, 'Securities', 'portfolio', 'EUR')`,
  ).run(PORT);
}

// Root + single Equity leaf weighted at 50%, with `secId` assigned to it.
// Returns the deterministic category ids the assertions key on.
function seedTaxonomy(secId: string): { TAX: string; ROOT: string; EQUITY: string } {
  const TAX = 'tax-1';
  const ROOT = 'cat-root';
  const EQUITY = 'cat-equity';
  db.prepare(`INSERT INTO taxonomy (uuid, name, root) VALUES (?, 'Asset Classes', ?)`).run(TAX, ROOT);
  db.prepare(
    `INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank)
     VALUES (?, ?, NULL, 'Root', '#000', 10000, 0)`,
  ).run(ROOT, TAX);
  db.prepare(
    `INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank)
     VALUES (?, ?, ?, 'Equity', '#111', 5000, 0)`,
  ).run(EQUITY, TAX, ROOT);
  db.prepare(
    `INSERT INTO taxonomy_assignment (taxonomy, category, item_type, item, weight, rank)
     VALUES (?, ?, 'security', ?, 10000, 0)`,
  ).run(TAX, EQUITY, secId);
  return { TAX, ROOT, EQUITY };
}

function rebalanceRow(taxonomyId: string, categoryId: string, secId: string) {
  const result = computeRebalancing(db, taxonomyId, DATE);
  expect(result).not.toBeNull();
  const category = result!.categories.find((c) => c.categoryId === categoryId);
  expect(category).toBeDefined();
  const sec = category!.securities.find((s) => s.securityId === secId);
  expect(sec).toBeDefined();
  return { category: category!, sec: sec! };
}

describe('computeRebalancing — cross-currency share count', () => {
  it('divides the base rebalance amount by the base-converted price per share, not the native quote', () => {
    const SEC = 'sec-usd';
    insertSecuritiesAccount();
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, 'USD Stock', 'USD', 0)`,
    ).run(SEC);
    // 10 shares held. Native quote US$100 → US$1000 native MV → €800 at USD→EUR 0.8.
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
       VALUES ('tx1', 'BUY', ?, 'EUR', ?, ?, ?, ?, 'portfolio')`,
    ).run(DATE, euros(800), shares(10), SEC, PORT);
    db.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC, DATE, price(100));
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES (?, 'USD', 'EUR', '0.8')`,
    ).run(DATE);
    const { TAX, EQUITY } = seedTaxonomy(SEC);

    const { category, sec } = rebalanceRow(TAX, EQUITY, SEC);

    // Statement-derived inputs: base MV €800, native quote US$100 preserved for display.
    expect(category.actualValue).toBe('800.00');
    expect(sec.currentPrice).toBe('100');
    // Target €400 (50% of €800) − actual €800 = −€400 to sell.
    expect(sec.rebalanceAmount).toBe('-400.00');

    // Correct: −€400 / (€800 / 10 shares = €80 base price) = −5 shares.
    // The bug divides by the native US$100 quote → −4 shares.
    expect(sec.rebalanceShares).toBe('-5.0000');
  });

  it('leaves a same-currency holding unchanged (base price equals native quote)', () => {
    const SEC = 'sec-eur';
    insertSecuritiesAccount();
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, 'EUR Stock', 'EUR', 0)`,
    ).run(SEC);
    // 10 shares @ €100 = €1000, no FX involved.
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
       VALUES ('tx1', 'BUY', ?, 'EUR', ?, ?, ?, ?, 'portfolio')`,
    ).run(DATE, euros(1000), shares(10), SEC, PORT);
    db.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC, DATE, price(100));
    const { TAX, EQUITY } = seedTaxonomy(SEC);

    const { sec } = rebalanceRow(TAX, EQUITY, SEC);

    // Target €500 − actual €1000 = −€500; base price = native €100 → −5 shares.
    expect(sec.rebalanceAmount).toBe('-500.00');
    expect(sec.currentPrice).toBe('100');
    expect(sec.rebalanceShares).toBe('-5.0000');
  });

  it('yields a zero share count for an assigned-but-unheld security (no crash, no NaN)', () => {
    const SEC = 'sec-unheld';
    // Security assigned to the taxonomy but never bought → no statement entry,
    // so no price and no shares are available to size a trade.
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, 'Unheld', 'EUR', 0)`,
    ).run(SEC);
    const { TAX, EQUITY } = seedTaxonomy(SEC);

    const { sec } = rebalanceRow(TAX, EQUITY, SEC);

    expect(sec.rebalanceShares).toBe('0.0000');
  });
});
