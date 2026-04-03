// packages/api/src/services/csv/csv-trade-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { mapTradeRows, type TradeMapperContext } from './csv-trade-mapper';
import { TransactionType } from '@quovibe/shared';
import type { NormalizedTradeRow } from '@quovibe/shared';

const ctx: TradeMapperContext = {
  portfolioId: 'port-1',
  depositAccountId: 'dep-1',
  portfolioCurrency: 'EUR',
  securityMap: new Map([
    ['Apple Inc', 'sec-apple'],
    ['BASF', 'sec-basf'],
  ]),
};

describe('mapTradeRows', () => {
  describe('Group A — BUY/SELL (dual-entry)', () => {
    it('BUY produces 2 xact rows + 1 cross-entry', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
        fees: 5,
        taxes: 2,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
      expect(result.crossEntries).toHaveLength(1);

      // Securities-side row
      const secRow = result.transactions[0];
      expect(secRow.type).toBe('BUY');
      expect(secRow.accountId).toBe('port-1');
      expect(secRow.securityId).toBe('sec-apple');
      expect(secRow.shares).toBe(1000000000); // 10 * 10^8
      // Net amount for BUY = (gross + fees + taxes) * 100 = (1500 + 5 + 2) * 100
      expect(secRow.amount).toBe(150700);
      expect(secRow.acctype).toBe('portfolio');
      expect(secRow.fees).toBe(500); // 5 * 100
      expect(secRow.taxes).toBe(200); // 2 * 100

      // Cash-side row (shadow)
      const cashRow = result.transactions[1];
      expect(cashRow.type).toBe('BUY');
      expect(cashRow.accountId).toBe('dep-1');
      expect(cashRow.securityId).toBe('sec-apple'); // D4 fix: security on cash-side
      expect(cashRow.shares).toBe(0);
      expect(cashRow.amount).toBe(150700); // same net amount
      expect(cashRow.acctype).toBe('account');
      expect(cashRow.fees).toBe(0); // no fees on cash-side
      expect(cashRow.taxes).toBe(0);

      // Cross-entry
      const ce = result.crossEntries[0];
      expect(ce.fromXact).toBe(secRow.id);
      expect(ce.fromAcc).toBe('port-1');
      expect(ce.toXact).toBe(cashRow.id);
      expect(ce.toAcc).toBe('dep-1');
      expect(ce.type).toBe('buysell');
    });

    it('SELL produces 2 xact rows with inflow net amount', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-02-01',
        type: TransactionType.SELL,
        securityName: 'BASF',
        shares: 5,
        amount: 800,
        fees: 10,
        taxes: 3,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(2);

      // SELL inflow: net = (gross - fees - taxes) * 100 = (800 - 10 - 3) * 100
      expect(result.transactions[0].amount).toBe(78700);
    });

    it('BUY without shares produces a row error', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 3,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        amount: 1500,
        // shares is missing
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('MISSING_SHARES');
      expect(result.errors[0].row).toBe(3);
    });
  });

  describe('Group B — cash-only (deposit account)', () => {
    it('DEPOSIT produces 1 xact row on deposit account', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-10',
        type: TransactionType.DEPOSIT,
        securityName: '',
        amount: 5000,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(1);
      expect(result.crossEntries).toHaveLength(0);

      const row = result.transactions[0];
      expect(row.type).toBe('DEPOSIT');
      expect(row.accountId).toBe('dep-1');
      expect(row.amount).toBe(500000); // 5000 * 100
      expect(row.shares).toBe(0);
      expect(row.acctype).toBe('account');
    });

    it('DIVIDEND requires securityId', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 5,
        date: '2024-03-15',
        type: TransactionType.DIVIDEND,
        securityName: 'Unknown Corp',
        amount: 50,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('MISSING_SECURITY');
    });

    it('DIVIDEND with known security maps to deposit', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-03-15',
        type: TransactionType.DIVIDEND,
        securityName: 'Apple Inc',
        amount: 50,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].accountId).toBe('dep-1');
      expect(result.transactions[0].securityId).toBe('sec-apple');
    });
  });

  describe('Group C — shares-only (portfolio account)', () => {
    it('DELIVERY_INBOUND produces 1 xact row on portfolio account', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.DELIVERY_INBOUND,
        securityName: 'Apple Inc',
        shares: 20,
        amount: 3000,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(1);
      expect(result.crossEntries).toHaveLength(0);

      const row = result.transactions[0];
      expect(row.type).toBe('DELIVERY_INBOUND');
      expect(row.accountId).toBe('port-1');
      expect(row.shares).toBe(2000000000); // 20 * 10^8
      expect(row.acctype).toBe('portfolio');
    });
  });

  describe('Amount sign normalization', () => {
    it('takes absolute value of negative amounts', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: -1500, // negative = cash outflow convention
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions[0].amount).toBe(150000); // abs(1500) * 100
    });
  });

  describe('Multiple rows', () => {
    it('processes mixed transaction types', () => {
      const rows: NormalizedTradeRow[] = [
        { rowNumber: 1, date: '2024-01-01', type: TransactionType.DEPOSIT, securityName: '', amount: 10000 },
        { rowNumber: 2, date: '2024-01-02', type: TransactionType.BUY, securityName: 'Apple Inc', shares: 5, amount: 750 },
        { rowNumber: 3, date: '2024-01-03', type: TransactionType.DIVIDEND, securityName: 'Apple Inc', amount: 10 },
      ];

      const result = mapTradeRows(rows, ctx);
      // DEPOSIT=1 + BUY=2 + DIVIDEND=1 = 4 xact rows
      expect(result.transactions).toHaveLength(4);
      // Only BUY has cross-entry
      expect(result.crossEntries).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });
});
