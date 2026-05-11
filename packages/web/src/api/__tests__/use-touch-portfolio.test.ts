// packages/web/src/api/__tests__/use-touch-portfolio.test.ts
//
// Pins the throttle-loop close: the optimistic registry update fed by
// `useTouchPortfolio.onSuccess`. Without it, PortfolioLayout's
// `shouldTouchPortfolio` check would keep seeing the OLD `lastOpenedAt` for
// the throttle window and refire the touch on every sub-page mount.

import { describe, test, expect } from 'vitest';
import { applyTouchToRegistry } from '../use-portfolios';
import type {
  PortfolioRegistryEntry,
  PortfolioRegistryResponse,
} from '../use-portfolios';

function mkEntry(id: string, lastOpenedAt: string | null): PortfolioRegistryEntry {
  return {
    id,
    name: id,
    kind: 'real',
    source: 'fresh',
    createdAt: '2025-01-01T00:00:00Z',
    lastOpenedAt,
  };
}

function mkRegistry(entries: PortfolioRegistryEntry[]): PortfolioRegistryResponse {
  return {
    initialized: true,
    defaultPortfolioId: entries[0]?.id ?? null,
    portfolios: entries,
  };
}

describe('applyTouchToRegistry', () => {
  test('passes through when prev is undefined (cache empty)', () => {
    const updated = mkEntry('a', '2026-04-30T12:00:00Z');
    expect(applyTouchToRegistry(undefined, updated)).toBeUndefined();
  });

  test('updates only the touched id, leaves siblings untouched', () => {
    const prev = mkRegistry([
      mkEntry('a', null),
      mkEntry('b', '2026-04-01T00:00:00Z'),
    ]);
    const updated = mkEntry('a', '2026-04-30T12:00:00Z');

    const next = applyTouchToRegistry(prev, updated);

    expect(next?.portfolios.find((p) => p.id === 'a')?.lastOpenedAt).toBe('2026-04-30T12:00:00Z');
    expect(next?.portfolios.find((p) => p.id === 'b')?.lastOpenedAt).toBe('2026-04-01T00:00:00Z');
  });

  test('preserves other portfolio fields (name, kind, source, createdAt)', () => {
    const prev = mkRegistry([{
      id: 'a', name: 'Alpha', kind: 'real', source: 'fresh',
      createdAt: '2025-06-01T00:00:00Z', lastOpenedAt: null,
    }]);
    const updated: PortfolioRegistryEntry = {
      id: 'a', name: 'Alpha-renamed', kind: 'real', source: 'fresh',
      createdAt: '2099-01-01T00:00:00Z', // server reply might carry a different name; we only adopt lastOpenedAt
      lastOpenedAt: '2026-04-30T12:00:00Z',
    };

    const next = applyTouchToRegistry(prev, updated);
    const a = next?.portfolios[0];
    expect(a?.name).toBe('Alpha');
    expect(a?.createdAt).toBe('2025-06-01T00:00:00Z');
    expect(a?.lastOpenedAt).toBe('2026-04-30T12:00:00Z');
  });

  test('preserves top-level `initialized` and `defaultPortfolioId`', () => {
    const prev: PortfolioRegistryResponse = {
      initialized: true,
      defaultPortfolioId: 'a',
      portfolios: [mkEntry('a', null), mkEntry('b', null)],
    };
    const updated = mkEntry('b', '2026-04-30T12:00:00Z');

    const next = applyTouchToRegistry(prev, updated);

    expect(next?.initialized).toBe(true);
    expect(next?.defaultPortfolioId).toBe('a');
  });

  test('no-op when the touched id is not in the registry (deleted mid-flight)', () => {
    const prev = mkRegistry([mkEntry('a', null)]);
    const updated = mkEntry('gone', '2026-04-30T12:00:00Z');

    const next = applyTouchToRegistry(prev, updated);

    // Returns the prev reference unchanged so React Query's reference-equality
    // dedupe avoids a no-op broadcast to every registry consumer.
    expect(next).toBe(prev);
  });

  test('returns prev reference unchanged when timestamp matches (no-op short-circuit)', () => {
    const prev = mkRegistry([mkEntry('a', '2026-04-30T12:00:00Z')]);
    const updated = mkEntry('a', '2026-04-30T12:00:00Z');

    expect(applyTouchToRegistry(prev, updated)).toBe(prev);
  });
});
