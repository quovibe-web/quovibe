import { describe, it, expect } from 'vitest';
import { TransactionType } from '@quovibe/shared';
import type { TransactionWithUnits } from '@quovibe/shared';
import { inheritTransferCostBasis } from '../transfer-cost';

// 100 shares raw = 100 × 1e8
const S = (n: number): number => Math.round(n * 1e8);

function makeTx(
  overrides: Partial<TransactionWithUnits> & {
    accountId: string;
    transferDirection?: 'IN' | 'OUT';
  },
): TransactionWithUnits & { accountId: string; transferDirection?: 'IN' | 'OUT' } {
  return {
    id: 'tx-' + Math.random(),
    type: TransactionType.BUY,
    date: '2024-01-01',
    currencyCode: 'EUR',
    amount: null,
    shares: null,
    note: null,
    securityId: 'SEC1',
    source: 'MANUAL',
    updatedAt: null,
    units: [],
    ...overrides,
  } as TransactionWithUnits & { accountId: string; transferDirection?: 'IN' | 'OUT' };
}

// Helper to sum result amounts for a given type
function totalAmountByType(txs: TransactionWithUnits[], type: TransactionType): number {
  return txs
    .filter((t) => t.type === type)
    .reduce((s, t) => s + (t.amount ?? 0), 0);
}

describe('inheritTransferCostBasis — single-lot transfer', () => {
  it('INBOUND row carries inherited cost; source lot is consumed', () => {
    // BUY 100 shares @€10 in account A (amount = gross = 1000)
    // TRANSFER_OUT 100 from A → TRANSFER_IN 100 to B
    const txs = [
      makeTx({ type: TransactionType.BUY,                date: '2024-01-10', accountId: 'A', shares: S(100), amount: 1000 }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER,  date: '2024-03-01', accountId: 'A', shares: S(100), transferDirection: 'OUT' }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER,  date: '2024-03-01', accountId: 'B', shares: S(100), transferDirection: 'IN'  }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);

    const outbound = result.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_OUTBOUND);
    const inbound  = result.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_INBOUND);

    expect(outbound).toHaveLength(1);
    expect(inbound).toHaveLength(1);

    // Carrying cost = 100 shares × €10/share = €1000
    expect(outbound[0].amount).toBeCloseTo(1000, 6);
    expect(inbound[0].amount).toBeCloseTo(1000, 6);
    expect(inbound[0].shares).toBeCloseTo(S(100), 0);
  });

  it('BUY rows pass through unchanged', () => {
    const txs = [
      makeTx({ type: TransactionType.BUY, date: '2024-01-10', accountId: 'A', shares: S(50), amount: 500 }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe(TransactionType.BUY);
    expect(result[0].amount).toBe(500);
  });
});

describe('inheritTransferCostBasis — partial-lot transfer', () => {
  it('transfers N of M shares; source keeps remaining lot', () => {
    // BUY 100 @€10 in A. Transfer 60 to B. Source should retain lot with 40 shares.
    // If we then SELL 40 from A, cost = 40 × 10 = 400.
    const txs = [
      makeTx({ type: TransactionType.BUY,               date: '2024-01-10', accountId: 'A', shares: S(100), amount: 1000 }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'A', shares: S(60),  transferDirection: 'OUT' }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'B', shares: S(60),  transferDirection: 'IN'  }),
      makeTx({ type: TransactionType.SELL,              date: '2024-06-01', accountId: 'A', shares: S(40),  amount: 480 }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);

    const inbound = result.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_INBOUND);
    expect(inbound).toHaveLength(1);
    // Inherited cost for 60 shares @€10 = €600
    expect(inbound[0].amount).toBeCloseTo(600, 6);
    expect(inbound[0].shares).toBeCloseTo(S(60), 0);

    // Outbound amount = carrying cost = 600
    const outbound = result.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_OUTBOUND);
    expect(outbound[0].amount).toBeCloseTo(600, 6);
  });
});

describe('inheritTransferCostBasis — multi-lot transfer', () => {
  it('two BUYs at different prices → two INBOUND rows preserving per-lot basis', () => {
    // BUY 30 @€10 (cost 300), BUY 20 @€12.50 (cost 250). Transfer all 50.
    const txs = [
      makeTx({ type: TransactionType.BUY,               date: '2024-01-10', accountId: 'A', shares: S(30), amount: 300 }),
      makeTx({ type: TransactionType.BUY,               date: '2024-02-01', accountId: 'A', shares: S(20), amount: 250 }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'A', shares: S(50), transferDirection: 'OUT' }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'B', shares: S(50), transferDirection: 'IN'  }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);

    const inbound = result.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_INBOUND);
    // Two lots → two inbound rows
    expect(inbound).toHaveLength(2);

    // First lot: 30 shares @€10 = €300
    expect(inbound[0].shares).toBeCloseTo(S(30), 0);
    expect(inbound[0].amount).toBeCloseTo(300, 6);

    // Second lot: 20 shares @€12.50 = €250
    expect(inbound[1].shares).toBeCloseTo(S(20), 0);
    expect(inbound[1].amount).toBeCloseTo(250, 6);
  });
});

describe('inheritTransferCostBasis — MA-wash invariant', () => {
  it('total cost before and after a wash transfer is unchanged at portfolio scope', () => {
    // At portfolio scope both legs are present. Total shares and total cost
    // remain the same after the transfer pair.
    // BUY 100 @€10 in A. Transfer 100 A→B. No SELL.
    // Total cost = 1000, total shares = 100 throughout.
    const txs = [
      makeTx({ type: TransactionType.BUY,               date: '2024-01-10', accountId: 'A', shares: S(100), amount: 1000 }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'A', shares: S(100), transferDirection: 'OUT' }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'B', shares: S(100), transferDirection: 'IN'  }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);

    // Net cost in: BUY + INBOUND = 1000 + 1000 = 2000
    // Net cost out: OUTBOUND = 1000
    // Net = +1000 (BUY introduces cost once; transfer pair is a wash)
    const inboundCost  = totalAmountByType(result, TransactionType.SECURITY_TRANSFER_INBOUND);
    const outboundCost = totalAmountByType(result, TransactionType.SECURITY_TRANSFER_OUTBOUND);
    expect(inboundCost).toBeCloseTo(outboundCost, 6); // transfer pair is a wash
  });
});

describe('inheritTransferCostBasis — no matching outbound (destination-only view)', () => {
  it('emits zero-cost INBOUND when no matching outbound exists', () => {
    const txs = [
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'B', shares: S(50), transferDirection: 'IN' }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe(TransactionType.SECURITY_TRANSFER_INBOUND);
    // amount unchanged (still null or 0) — zero-cost fallback
    expect(result[0].shares).toBe(S(50));
  });
});

describe('inheritTransferCostBasis — lot date preservation (FIFO parity)', () => {
  it('INBOUND rows carry original BUY date, not transfer date', () => {
    // BUY on Jan 10 in A; transfer on Mar 1 to B.
    // INBOUND row must have date='2024-01-10' so computeFIFO orders it
    // correctly relative to BUYs in B that happened between Jan and Mar.
    const txs = [
      makeTx({ type: TransactionType.BUY,               date: '2024-01-10', accountId: 'A', shares: S(100), amount: 1000 }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'A', shares: S(100), transferDirection: 'OUT' }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'B', shares: S(100), transferDirection: 'IN'  }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);
    const inbound = result.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_INBOUND);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].date).toBe('2024-01-10'); // original BUY date, not '2024-03-01'
  });

  it('multi-lot transfer: each INBOUND row carries its own BUY date', () => {
    const txs = [
      makeTx({ type: TransactionType.BUY,               date: '2024-01-10', accountId: 'A', shares: S(30), amount: 300 }),
      makeTx({ type: TransactionType.BUY,               date: '2024-02-01', accountId: 'A', shares: S(20), amount: 250 }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'A', shares: S(50), transferDirection: 'OUT' }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'B', shares: S(50), transferDirection: 'IN'  }),
    ] as TransactionWithUnits[];

    const result = inheritTransferCostBasis(txs);
    const inbound = result.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_INBOUND);
    expect(inbound).toHaveLength(2);
    expect(inbound[0].date).toBe('2024-01-10');
    expect(inbound[1].date).toBe('2024-02-01');
  });
});

describe('inheritTransferCostBasis — idempotence', () => {
  it('running twice produces the same output (already-typed rows pass through)', () => {
    const txs = [
      makeTx({ type: TransactionType.BUY,               date: '2024-01-10', accountId: 'A', shares: S(100), amount: 1000 }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'A', shares: S(100), transferDirection: 'OUT' }),
      makeTx({ type: TransactionType.SECURITY_TRANSFER, date: '2024-03-01', accountId: 'B', shares: S(100), transferDirection: 'IN'  }),
    ] as TransactionWithUnits[];

    const pass1 = inheritTransferCostBasis(txs);
    const pass2 = inheritTransferCostBasis(pass1);

    const inbound1  = pass1.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_INBOUND);
    const inbound2  = pass2.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_INBOUND);
    const outbound1 = pass1.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_OUTBOUND);
    const outbound2 = pass2.filter((t) => t.type === TransactionType.SECURITY_TRANSFER_OUTBOUND);

    expect(inbound2).toHaveLength(inbound1.length);
    expect(outbound2).toHaveLength(outbound1.length);
    expect(inbound2[0]?.amount).toBeCloseTo(inbound1[0]?.amount ?? 0, 6);
    expect(outbound2[0]?.amount).toBeCloseTo(outbound1[0]?.amount ?? 0, 6);
  });
});
