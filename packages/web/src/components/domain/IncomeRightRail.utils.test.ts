import { describe, it, expect } from 'vitest';
import {
  extractTopPayers,
  computeConcentration,
  aggregateByType,
} from './IncomeRightRail.utils';
import type { PaymentGroup } from '@/api/types';

function group(bucket: string, payments: Array<Partial<{
  id: string;
  type: 'DIVIDEND' | 'INTEREST';
  date: string;
  grossAmount: string;
  netAmount: string;
  securityId: string | null;
  securityName: string | null;
  accountId: string | null;
  accountName: string | null;
  currencyCode: string | null;
  taxes: string;
  fees: string;
}>>): PaymentGroup {
  const filled = payments.map((p, i) => ({
    id: p.id ?? `p${i}`,
    type: p.type ?? 'DIVIDEND',
    date: p.date ?? `${bucket}-15`,
    grossAmount: p.grossAmount ?? '0',
    netAmount: p.netAmount ?? p.grossAmount ?? '0',
    taxes: p.taxes ?? '0',
    fees: p.fees ?? '0',
    currencyCode: p.currencyCode ?? 'EUR',
    securityId: p.securityId ?? null,
    securityName: p.securityName ?? null,
    accountId: p.accountId ?? null,
    accountName: p.accountName ?? null,
  }));
  const totalGross = filled.reduce((s, p) => s + parseFloat(p.grossAmount), 0).toString();
  const totalNet = filled.reduce((s, p) => s + parseFloat(p.netAmount), 0).toString();
  return { bucket, totalGross, totalNet, count: filled.length, payments: filled };
}

describe('extractTopPayers', () => {
  it('ranks securities by total gross amount', () => {
    const groups = [
      group('2026-01', [
        { securityName: 'VWCE', grossAmount: '1000' },
        { securityName: 'MSFT', grossAmount: '500' },
      ]),
      group('2026-02', [{ securityName: 'VWCE', grossAmount: '800' }]),
    ];
    const result = extractTopPayers(groups, 'gross');
    expect(result.payers).toEqual([
      { name: 'VWCE', total: 1800, share: 1800 / 2300 },
      { name: 'MSFT', total: 500, share: 500 / 2300 },
    ]);
    expect(result.cashInterest).toBeNull();
  });

  it('lumps cash interest separately from named securities', () => {
    const groups = [
      group('2026-01', [
        { securityName: 'VWCE', grossAmount: '1000', type: 'DIVIDEND' },
        { securityName: null, grossAmount: '300', type: 'INTEREST' },
        { securityName: null, grossAmount: '200', type: 'INTEREST' },
      ]),
    ];
    const result = extractTopPayers(groups, 'gross');
    expect(result.payers).toEqual([
      { name: 'VWCE', total: 1000, share: 1000 / 1500 },
    ]);
    expect(result.cashInterest).toEqual({ total: 500, share: 500 / 1500 });
  });

  it('uses net amount when mode=net', () => {
    const groups = [
      group('2026-01', [{ securityName: 'VWCE', grossAmount: '1000', netAmount: '750' }]),
    ];
    const result = extractTopPayers(groups, 'net');
    expect(result.payers[0]?.total).toBe(750);
  });

  it('returns empty arrays when no payments', () => {
    const result = extractTopPayers([], 'gross');
    expect(result.payers).toEqual([]);
    expect(result.cashInterest).toBeNull();
  });

  it('skips DIVIDEND payments with null securityName (defensive against bad data)', () => {
    const groups = [
      group('2026-01', [
        { securityName: 'VWCE', grossAmount: '1000', type: 'DIVIDEND' },
        { securityName: null, grossAmount: '500', type: 'DIVIDEND' }, // anomalous
        { securityName: null, grossAmount: '200', type: 'INTEREST' },
      ]),
    ];
    const result = extractTopPayers(groups, 'gross');
    expect(result.payers).toEqual([
      { name: 'VWCE', total: 1000, share: 1000 / 1200 },
    ]);
    expect(result.cashInterest).toEqual({ total: 200, share: 200 / 1200 });
  });
});

describe('computeConcentration', () => {
  it('returns top-3 share when 5+ payers', () => {
    const payers = [
      { name: 'A', total: 50, share: 0.5 },
      { name: 'B', total: 25, share: 0.25 },
      { name: 'C', total: 15, share: 0.15 },
      { name: 'D', total: 5, share: 0.05 },
      { name: 'E', total: 3, share: 0.03 },
      { name: 'F', total: 2, share: 0.02 },
    ];
    expect(computeConcentration(payers)).toEqual({ top3Share: 0.9, payerCount: 6 });
  });

  it('still returns when fewer than 5 payers (caller decides render gate)', () => {
    const payers = [
      { name: 'A', total: 60, share: 0.6 },
      { name: 'B', total: 30, share: 0.3 },
      { name: 'C', total: 10, share: 0.1 },
    ];
    const result = computeConcentration(payers);
    expect(result.payerCount).toBe(3);
    expect(result.top3Share).toBeCloseTo(1, 5);
  });

  it('returns zero shape when empty', () => {
    expect(computeConcentration([])).toEqual({ top3Share: 0, payerCount: 0 });
  });
});

describe('aggregateByType', () => {
  it('sums dividend + interest separately', () => {
    const groups = [
      group('2026-01', [
        { type: 'DIVIDEND', grossAmount: '1000' },
        { type: 'INTEREST', grossAmount: '200' },
      ]),
      group('2026-02', [{ type: 'DIVIDEND', grossAmount: '500' }]),
    ];
    expect(aggregateByType(groups, 'gross')).toEqual({
      dividend: 1500,
      interest: 200,
      total: 1700,
      dividendShare: 1500 / 1700,
      interestShare: 200 / 1700,
    });
  });

  it('handles all-zero with zero shares', () => {
    expect(aggregateByType([], 'gross')).toEqual({
      dividend: 0,
      interest: 0,
      total: 0,
      dividendShare: 0,
      interestShare: 0,
    });
  });
});
