import { describe, it, expect } from 'vitest';
import {
  sortByRecency,
  pickActivePortfolio,
  pickTabPortfolio,
} from '../portfolio-recency';
import type { PortfolioRegistryEntry } from '@/api/use-portfolios';

function mk(id: string, lastOpenedAt: string | null, createdAt: string): PortfolioRegistryEntry {
  return { id, name: id, kind: 'real', source: 'fresh', createdAt, lastOpenedAt };
}

describe('sortByRecency', () => {
  it('orders by lastOpenedAt DESC', () => {
    const a = mk('a', '2026-04-01T00:00:00Z', '2025-01-01T00:00:00Z');
    const b = mk('b', '2026-04-18T00:00:00Z', '2025-01-01T00:00:00Z');
    const c = mk('c', '2026-04-10T00:00:00Z', '2025-01-01T00:00:00Z');
    const sorted = [a, b, c].sort(sortByRecency).map((p) => p.id);
    expect(sorted).toEqual(['b', 'c', 'a']);
  });

  it('NULLS LAST on lastOpenedAt, tiebreak on createdAt DESC', () => {
    const a = mk('a', null, '2025-01-01T00:00:00Z');
    const b = mk('b', null, '2026-01-01T00:00:00Z');
    const c = mk('c', '2026-04-01T00:00:00Z', '2024-01-01T00:00:00Z');
    const sorted = [a, b, c].sort(sortByRecency).map((p) => p.id);
    expect(sorted).toEqual(['c', 'b', 'a']);
  });

  it('tiebreaks on createdAt DESC when lastOpenedAt is equal and non-null', () => {
    const a = mk('a', '2026-04-18T00:00:00Z', '2025-01-01T00:00:00Z');
    const b = mk('b', '2026-04-18T00:00:00Z', '2026-01-01T00:00:00Z');
    expect([a, b].sort(sortByRecency).map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('pickActivePortfolio', () => {
  it('returns null when the registry is empty', () => {
    expect(pickActivePortfolio([])).toBeNull();
  });

  it('returns the single portfolio when there is only one', () => {
    const only = mk('only', null, '2025-01-01T00:00:00Z');
    expect(pickActivePortfolio([only])).toBe(only);
  });

  it('returns the most recently opened portfolio', () => {
    const a = mk('a', '2026-04-01T00:00:00Z', '2025-01-01T00:00:00Z');
    const b = mk('b', '2026-04-18T00:00:00Z', '2025-01-01T00:00:00Z');
    expect(pickActivePortfolio([a, b])?.id).toBe('b');
  });
});

describe('pickTabPortfolio', () => {
  const a = mk('a', '2026-04-01T00:00:00Z', '2025-01-01T00:00:00Z');
  const b = mk('b', '2026-04-18T00:00:00Z', '2025-01-01T00:00:00Z');

  it('returns null when the tab id is null', () => {
    expect(pickTabPortfolio(null, [a, b])).toBeNull();
  });

  it('returns null when the registry is empty', () => {
    expect(pickTabPortfolio('a', [])).toBeNull();
  });

  it('returns the matching entry when the tab id is present', () => {
    expect(pickTabPortfolio('a', [a, b])).toBe(a);
  });

  it('returns null when the tab id is stale (portfolio deleted)', () => {
    expect(pickTabPortfolio('zzz', [a, b])).toBeNull();
  });

  it('does NOT consult lastOpenedAt — tab id is the sole signal', () => {
    // Even though `b` is more recently opened globally, `a` wins because
    // sessionStorage said this tab was on `a`. This is the cross-tab leak
    // fix: per-tab continuity beats global recency.
    expect(pickTabPortfolio('a', [a, b])?.id).toBe('a');
  });
});
