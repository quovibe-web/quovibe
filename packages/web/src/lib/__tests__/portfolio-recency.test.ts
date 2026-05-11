import { describe, it, expect } from 'vitest';
import {
  sortByRecency,
  pickActivePortfolio,
  pickTabPortfolio,
  shouldTouchPortfolio,
  pickRootRedirectTarget,
  PORTFOLIO_TOUCH_THROTTLE_MS,
} from '../portfolio-recency';
import type { PortfolioRegistryEntry } from '@/api/use-portfolios';

function mk(
  id: string,
  lastOpenedAt: string | null,
  createdAt: string,
  kind: 'real' | 'demo' = 'real',
): PortfolioRegistryEntry {
  return {
    id,
    name: id,
    kind,
    source: kind === 'demo' ? 'demo' : 'fresh',
    createdAt,
    lastOpenedAt,
  };
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

describe('shouldTouchPortfolio', () => {
  const NOW = Date.parse('2026-04-30T12:00:00Z');

  it('returns true when lastOpenedAt is null (never touched)', () => {
    expect(shouldTouchPortfolio(null, NOW)).toBe(true);
  });

  it('returns true when lastOpenedAt is undefined', () => {
    expect(shouldTouchPortfolio(undefined, NOW)).toBe(true);
  });

  it('returns false when lastOpenedAt is within the throttle window', () => {
    expect(shouldTouchPortfolio('2026-04-30T11:58:00Z', NOW)).toBe(false);
  });

  it('returns true when lastOpenedAt is older than the throttle window', () => {
    expect(shouldTouchPortfolio('2026-04-30T11:50:00Z', NOW)).toBe(true);
  });

  it('boundary: exactly throttleMs ago returns true (>= comparison)', () => {
    expect(shouldTouchPortfolio(new Date(NOW - PORTFOLIO_TOUCH_THROTTLE_MS).toISOString(), NOW)).toBe(true);
  });

  it('returns true on unparseable lastOpenedAt (defensive)', () => {
    expect(shouldTouchPortfolio('not-a-date', NOW)).toBe(true);
  });

  it('honours custom throttle window', () => {
    const fiveMinAgo = '2026-04-30T11:55:00Z';
    expect(shouldTouchPortfolio(fiveMinAgo, NOW, 60_000)).toBe(true); // 1-min window
    expect(shouldTouchPortfolio(fiveMinAgo, NOW, 10 * 60_000)).toBe(false); // 10-min window
  });
});

describe('pickRootRedirectTarget', () => {
  it('returns null when registry is empty (caller renders /welcome)', () => {
    expect(pickRootRedirectTarget([], null)).toBeNull();
  });

  it('returns most-recently-opened real portfolio when present', () => {
    const a = mk('a', '2026-04-29T10:00:00Z', '2025-01-01T00:00:00Z');
    const b = mk('b', '2026-04-30T11:00:00Z', '2025-01-01T00:00:00Z');
    expect(pickRootRedirectTarget([a, b], 'a')).toBe('b');
  });

  it('falls back to defaultPortfolioId when no real portfolio has been opened', () => {
    const a = mk('a', null, '2025-01-01T00:00:00Z');
    const b = mk('b', null, '2025-01-01T00:00:00Z');
    expect(pickRootRedirectTarget([a, b], 'a')).toBe('a');
  });

  it('skips demo portfolios from the recency calculation', () => {
    const real = mk('real', null, '2025-01-01T00:00:00Z');
    const demo = mk('demo', '2026-04-30T11:00:00Z', '2025-01-01T00:00:00Z', 'demo');
    expect(pickRootRedirectTarget([real, demo], 'real')).toBe('real');
  });

  it('honours defaultPortfolioId pointing at a demo entry when no real recency exists', () => {
    const real = mk('real', null, '2025-01-01T00:00:00Z');
    const demo = mk('demo', '2026-04-30T11:00:00Z', '2025-01-01T00:00:00Z', 'demo');
    expect(pickRootRedirectTarget([real, demo], 'demo')).toBe('demo');
  });

  it('returns null when defaultPortfolioId is stale (not in registry) and no real recency', () => {
    const a = mk('a', null, '2025-01-01T00:00:00Z');
    expect(pickRootRedirectTarget([a], 'gone-id')).toBeNull();
  });

  it('returns null when registry is empty even with a stale default id', () => {
    expect(pickRootRedirectTarget([], 'gone-id')).toBeNull();
  });
});

describe('pickTabPortfolio + pickRootRedirectTarget precedence (BUG-177)', () => {
  // Behavioral pin: RootRedirect.tsx composes
  //   tabHit?.id ?? pickRootRedirectTarget(...)
  // so per-tab session anchor wins over global recency. When the anchor is
  // null/stale, the recency pick takes over. This block locks the
  // composition rule the helpers must support.
  function resolveRedirect(
    tabId: string | null,
    portfolios: PortfolioRegistryEntry[],
    defaultPortfolioId: string | null,
  ): string | null {
    const tabHit = pickTabPortfolio(tabId, portfolios);
    return tabHit?.id ?? pickRootRedirectTarget(portfolios, defaultPortfolioId);
  }

  it('tab anchor wins over global recency when both are valid', () => {
    const a = mk('a', '2026-04-01T00:00:00Z', '2025-01-01T00:00:00Z');
    const b = mk('b', '2026-04-30T11:00:00Z', '2025-01-01T00:00:00Z'); // most recent
    expect(resolveRedirect('a', [a, b], null)).toBe('a');
  });

  it('falls back to recency when tab anchor is null', () => {
    const a = mk('a', '2026-04-01T00:00:00Z', '2025-01-01T00:00:00Z');
    const b = mk('b', '2026-04-30T11:00:00Z', '2025-01-01T00:00:00Z');
    expect(resolveRedirect(null, [a, b], null)).toBe('b');
  });

  it('falls back to recency when tab anchor is stale (portfolio deleted)', () => {
    const a = mk('a', '2026-04-01T00:00:00Z', '2025-01-01T00:00:00Z');
    expect(resolveRedirect('deleted-uuid', [a], null)).toBe('a');
  });

  it('falls back to defaultPortfolioId when tab anchor stale and no real recency', () => {
    const a = mk('a', null, '2025-01-01T00:00:00Z');
    expect(resolveRedirect('deleted-uuid', [a], 'a')).toBe('a');
  });

  it('returns null (→ /welcome) when both signals are absent', () => {
    expect(resolveRedirect(null, [], null)).toBeNull();
  });

  it('tab anchor on a real portfolio overrides a more-recent demo', () => {
    const real = mk('real', '2026-04-01T00:00:00Z', '2025-01-01T00:00:00Z');
    const demo = mk('demo', '2026-04-30T11:00:00Z', '2025-01-01T00:00:00Z', 'demo');
    // pickRootRedirectTarget would skip demo and pick real anyway, but
    // make the precedence explicit when the tab anchor is the demo.
    expect(resolveRedirect('demo', [real, demo], null)).toBe('demo');
  });
});
