// Engine regression: portfolio-base rollup consumption of pre-projected base-ccy txs
// Reference: docs/architecture/multi-currency.md § Phase 2
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  resolvePortfolioCashflows,
  computeIRR,
} from '../../index';
import type { TransactionWithUnits } from '@quovibe/shared';

function tx(
  partial: Partial<TransactionWithUnits> & {
    id: string;
    type: TransactionWithUnits['type'];
    date: string;
    amount: number;
  },
): TransactionWithUnits {
  return {
    id: partial.id,
    type: partial.type,
    date: partial.date,
    currencyCode: partial.currencyCode ?? 'EUR',
    amount: partial.amount,
    shares: partial.shares ?? 0,
    note: null,
    securityId: partial.securityId ?? null,
    source: null,
    updatedAt: null,
    units: [],
  };
}

describe('multi-currency portfolio rollup — engine consumption (post-projection)', () => {
  describe('BRK-B fixture — base-ccy projected txs', () => {
    const txs: TransactionWithUnits[] = [
      tx({ id: 'dep', type: 'DEPOSIT', date: '2026-01-15', amount: 1000 }),
      tx({ id: 'b1c', type: 'BUY', date: '2026-05-01', amount: 406.79, securityId: 'brkb' }),
      tx({ id: 'b1s', type: 'BUY', date: '2026-05-01', amount: 406.79, shares: 1, securityId: 'brkb' }),
      tx({ id: 'b2c', type: 'BUY', date: '2026-05-08', amount: 404.68, securityId: 'brkb' }),
      tx({ id: 'b2s', type: 'BUY', date: '2026-05-08', amount: 404.68, shares: 1, securityId: 'brkb' }),
    ];

    it('resolvePortfolioCashflows emits only DEPOSIT (BUYs are internal)', () => {
      const cfs = resolvePortfolioCashflows(txs);
      expect(cfs).toHaveLength(1);
      expect(cfs[0].type).toBe('DEPOSIT');
      expect(cfs[0].amount.toString()).toBe('1000');
    });

    it('IRR finite given base-ccy CFs + final MVE in EUR', () => {
      const cashflows = resolvePortfolioCashflows(txs);
      const irr = computeIRR({
        mvb: new Decimal(0),
        mve: new Decimal('1018.77'),
        cashflows,
        periodStart: '2025-12-31',
        periodEnd: '2026-05-17',
      });
      expect(irr).not.toBeNull();
      expect(irr!.isFinite()).toBe(true);
      expect(irr!.abs().lte(new Decimal('0.5'))).toBe(true);
    });
  });

  describe('cashflow type filter invariant', () => {
    it('BUY/SELL stay internal regardless of base projection', () => {
      const txs: TransactionWithUnits[] = [
        tx({ id: 'buy', type: 'BUY', date: '2025-01-01', amount: 500, securityId: 's1' }),
        tx({ id: 'dep', type: 'DEPOSIT', date: '2025-01-02', amount: 500 }),
      ];
      const cfs = resolvePortfolioCashflows(txs);
      expect(cfs.find((c) => c.type === 'BUY')).toBeUndefined();
      expect(cfs.find((c) => c.type === 'DEPOSIT')).toBeDefined();
    });
  });
});
