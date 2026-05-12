import { describe, it, expect } from 'vitest';
import {
  filterPayments,
  sortPayments,
  bucketByYear,
  parseFilterUrlParams,
  serializeFilterUrlParams,
  type DetailFilters,
  type DetailSort,
} from './IncomeDetailList.utils';
import type { Payment, PaymentGroup } from '@/api/types';

function p(overrides: Partial<Payment>): Payment {
  return {
    id: overrides.id ?? 'p',
    type: overrides.type ?? 'DIVIDEND',
    date: overrides.date ?? '2026-03-15',
    grossAmount: overrides.grossAmount ?? '100',
    netAmount: overrides.netAmount ?? overrides.grossAmount ?? '100',
    taxes: overrides.taxes ?? '0',
    fees: overrides.fees ?? '0',
    currencyCode: overrides.currencyCode ?? 'EUR',
    securityId: overrides.securityId ?? null,
    securityName: overrides.securityName ?? null,
    accountId: overrides.accountId ?? null,
    accountName: overrides.accountName ?? null,
  };
}

const sample: Payment[] = [
  p({ id: 'a', type: 'DIVIDEND', date: '2026-03-15', grossAmount: '500', securityId: 's1', securityName: 'VWCE' }),
  p({ id: 'b', type: 'INTEREST', date: '2026-03-28', grossAmount: '200' }),
  p({ id: 'c', type: 'DIVIDEND', date: '2025-11-10', grossAmount: '300', securityId: 's2', securityName: 'MSFT' }),
  p({ id: 'd', type: 'DIVIDEND', date: '2025-03-15', grossAmount: '450', securityId: 's1', securityName: 'VWCE' }),
];

describe('filterPayments', () => {
  it('returns all when no filters set', () => {
    const result = filterPayments(sample, { type: null, securityIds: [] });
    expect(result).toHaveLength(4);
  });

  it('filters by type=DIVIDEND', () => {
    const result = filterPayments(sample, { type: 'DIVIDEND', securityIds: [] });
    expect(result.map((x) => x.id)).toEqual(['a', 'c', 'd']);
  });

  it('filters by securityIds (multi)', () => {
    const result = filterPayments(sample, { type: null, securityIds: ['s1'] });
    expect(result.map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('combines type AND securityIds (AND semantics)', () => {
    const result = filterPayments(sample, { type: 'INTEREST', securityIds: ['s1'] });
    expect(result).toEqual([]);
  });
});

describe('sortPayments', () => {
  it('sorts date desc by default', () => {
    const result = sortPayments(sample, 'date-desc');
    expect(result.map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('sorts date asc', () => {
    const result = sortPayments(sample, 'date-asc');
    expect(result.map((x) => x.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('sorts amount desc by gross', () => {
    const result = sortPayments(sample, 'amount-desc');
    expect(result.map((x) => x.id)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('sorts security A→Z, nulls last', () => {
    const result = sortPayments(sample, 'security-asc');
    expect(result.map((x) => x.id)).toEqual(['c', 'a', 'd', 'b']);
  });
});

describe('bucketByYear', () => {
  it('groups month-keyed buckets into year buckets', () => {
    const groups: PaymentGroup[] = [
      { bucket: '2026-03', totalGross: '700', totalNet: '700', count: 2, payments: [sample[0]!, sample[1]!] },
      { bucket: '2025-11', totalGross: '300', totalNet: '300', count: 1, payments: [sample[2]!] },
      { bucket: '2025-03', totalGross: '450', totalNet: '450', count: 1, payments: [sample[3]!] },
    ];
    const result = bucketByYear(groups);
    expect(Array.from(result.keys()).sort()).toEqual([2025, 2026]);
    expect(result.get(2026)?.length).toBe(1);
    expect(result.get(2025)?.length).toBe(2);
  });

  it('handles unknown bucket shapes (quarter, etc.) by year prefix', () => {
    const groups: PaymentGroup[] = [
      { bucket: '2026-Q1', totalGross: '500', totalNet: '500', count: 1, payments: [sample[0]!] },
    ];
    const result = bucketByYear(groups);
    expect(result.get(2026)).toHaveLength(1);
  });

  it('returns empty map when no groups', () => {
    expect(bucketByYear([]).size).toBe(0);
  });
});

describe('URL param round-trip', () => {
  it('serializes and parses back to same shape', () => {
    const filters: DetailFilters = { type: 'DIVIDEND', securityIds: ['s1', 's2'] };
    const sort: DetailSort = 'amount-desc';
    const params = serializeFilterUrlParams(filters, sort);
    const parsed = parseFilterUrlParams(params);
    expect(parsed.filters).toEqual(filters);
    expect(parsed.sort).toEqual(sort);
  });

  it('omits default values from URL', () => {
    const params = serializeFilterUrlParams({ type: null, securityIds: [] }, 'date-desc');
    expect(params.toString()).toBe('');
  });

  it('parses missing keys as defaults', () => {
    const parsed = parseFilterUrlParams(new URLSearchParams());
    expect(parsed.filters).toEqual({ type: null, securityIds: [] });
    expect(parsed.sort).toBe('date-desc');
  });

  it('rejects invalid sort value, falls back to default', () => {
    const params = new URLSearchParams('sort=garbage');
    expect(parseFilterUrlParams(params).sort).toBe('date-desc');
  });

  it('rejects invalid type filter, treats as null', () => {
    const params = new URLSearchParams('filterType=NOPE');
    expect(parseFilterUrlParams(params).filters.type).toBeNull();
  });
});
