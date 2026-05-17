import { describe, expect, it } from 'vitest';
import { getHoldingsFlat } from '../reports.service';
import { createTestDb, euros, hasSqliteBindings, price, shares } from './test-fixtures';

describe('getHoldingsFlat', () => {
  it.skipIf(!hasSqliteBindings)('uses security value, not cash-inclusive portfolio value, for flat holdings totals', () => {
    const db = createTestDb();
    db.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
      .run('sec-a', 'Alpha', 'EUR', 0);
    db.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
      .run('sec-b', 'Beta', 'EUR', 0);
    db.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
      .run('acct-cash', 'Cash', 'account', 'EUR');

    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype)
      VALUES (?, 'DEPOSIT', ?, 'EUR', ?, 0, ?, 'account')`)
      .run('deposit', '2024-01-01', euros(1_000), 'acct-cash');
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
      VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'account')`)
      .run('buy-a', '2024-01-02', euros(100), shares(10), 'sec-a', 'acct-cash');
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
      VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'account')`)
      .run('buy-b', '2024-01-03', euros(300), shares(30), 'sec-b', 'acct-cash');

    db.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run('sec-a', '2024-01-31', price(10));
    db.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run('sec-b', '2024-01-31', price(10));

    const result = getHoldingsFlat(db, '2024-01-31');

    expect(result.totalMarketValue).toBe('400');
    expect(result.items).toEqual([
      expect.objectContaining({ securityId: 'sec-a', marketValue: '100', percentage: '25.00' }),
      expect.objectContaining({ securityId: 'sec-b', marketValue: '300', percentage: '75.00' }),
    ]);
  });
});
