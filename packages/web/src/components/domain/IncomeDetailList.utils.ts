import type { Payment, PaymentGroup } from '@/api/types';

export type DetailFilterType = 'DIVIDEND' | 'INTEREST' | null;

export interface DetailFilters {
  type: DetailFilterType;
  securityIds: string[];
}

export type DetailSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'security-asc';

const VALID_SORTS: ReadonlySet<DetailSort> = new Set([
  'date-desc',
  'date-asc',
  'amount-desc',
  'security-asc',
]);

const VALID_TYPES: ReadonlySet<NonNullable<DetailFilterType>> = new Set([
  'DIVIDEND',
  'INTEREST',
]);

export function filterPayments(
  payments: Payment[],
  filters: DetailFilters,
): Payment[] {
  const securitySet = new Set(filters.securityIds);
  return payments.filter((p) => {
    if (filters.type !== null && p.type !== filters.type) return false;
    if (securitySet.size > 0) {
      if (p.securityId === null || !securitySet.has(p.securityId)) return false;
    }
    return true;
  });
}

export function sortPayments(payments: Payment[], sort: DetailSort): Payment[] {
  const copy = [...payments];
  switch (sort) {
    case 'date-desc':
      copy.sort((a, b) => b.date.localeCompare(a.date));
      break;
    case 'date-asc':
      copy.sort((a, b) => a.date.localeCompare(b.date));
      break;
    case 'amount-desc':
      copy.sort((a, b) => parseFloat(b.grossAmount) - parseFloat(a.grossAmount));
      break;
    case 'security-asc':
      copy.sort((a, b) => {
        if (a.securityName === null && b.securityName === null) return 0;
        if (a.securityName === null) return 1;
        if (b.securityName === null) return -1;
        return a.securityName.localeCompare(b.securityName);
      });
      break;
  }
  return copy;
}

export function bucketByYear(groups: PaymentGroup[]): Map<number, PaymentGroup[]> {
  const out = new Map<number, PaymentGroup[]>();
  for (const g of groups) {
    const m = /^(\d{4})/.exec(g.bucket);
    if (!m) continue;
    const year = parseInt(m[1]!, 10);
    if (!out.has(year)) out.set(year, []);
    out.get(year)!.push(g);
  }
  return out;
}

export function parseFilterUrlParams(params: URLSearchParams): {
  filters: DetailFilters;
  sort: DetailSort;
} {
  const rawType = params.get('filterType');
  const type: DetailFilterType =
    rawType !== null && VALID_TYPES.has(rawType as 'DIVIDEND' | 'INTEREST')
      ? (rawType as 'DIVIDEND' | 'INTEREST')
      : null;
  const rawSec = params.get('securityIds');
  const securityIds = rawSec ? rawSec.split(',').filter(Boolean) : [];
  const rawSort = params.get('sort');
  const sort: DetailSort = VALID_SORTS.has(rawSort as DetailSort)
    ? (rawSort as DetailSort)
    : 'date-desc';
  return { filters: { type, securityIds }, sort };
}

export function serializeFilterUrlParams(
  filters: DetailFilters,
  sort: DetailSort,
): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.type !== null) out.set('filterType', filters.type);
  if (filters.securityIds.length > 0) out.set('securityIds', filters.securityIds.join(','));
  if (sort !== 'date-desc') out.set('sort', sort);
  return out;
}
