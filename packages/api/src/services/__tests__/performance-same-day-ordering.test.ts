import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { computeAllSecurities, fetchBatchData } from '../performance.service';
import { CostMethod } from '@quovibe/shared';

describe('BUG-182 — same-day BUY+SELL ordering', () => {
  let db: Database.Database;
  const PORTFOLIO = '00000000-0000-0000-0000-000000000001';
  const DEPOSIT = '00000000-0000-0000-0000-000000000002';
  const SECURITY = '00000000-0000-0000-0000-000000000003';

  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);

    db.exec(`
      INSERT INTO account (uuid, name, currency, type, isRetired, updatedAt, _xmlid, _order)
        VALUES ('${PORTFOLIO}', 'Portfolio', 'EUR', 'portfolio', 0, '2025-01-01', 1, 1),
               ('${DEPOSIT}', 'Cash', 'EUR', 'account', 0, '2025-01-01', 2, 2);
      INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
        VALUES ('${SECURITY}', 'TestSec', 'EUR', 0, '2025-01-01');
    `);
  });

  it('engine does not throw when SELL physically precedes BUY in the DB but both share the same date', () => {
    const sellUuid = '11111111-1111-1111-1111-111111111111';
    const buyUuid = '22222222-2222-2222-2222-222222222222';
    db.exec(`
      INSERT INTO xact (uuid, acctype, account, date, currency, amount, security, shares, source, updatedAt, type, _xmlid, _order)
        VALUES
          ('${sellUuid}', 'portfolio', '${PORTFOLIO}', '2025-03-14', 'EUR', 110000, '${SECURITY}', 1100000000, 'CSV_IMPORT', '2025-03-14', 'SELL', 1, 2),
          ('${buyUuid}', 'portfolio', '${PORTFOLIO}', '2025-03-14', 'EUR', 100000, '${SECURITY}', 1100000000, 'CSV_IMPORT', '2025-03-14', 'BUY',  2, 1);
    `);

    const data = fetchBatchData(db, { start: '2025-01-01', end: '2025-12-31' });
    expect(() =>
      computeAllSecurities(db, data, { start: '2025-01-01', end: '2025-12-31' }, CostMethod.FIFO, true),
    ).not.toThrow();
  });
});
