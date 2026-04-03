import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry';
import type { QuoteFeedProvider } from '../types';

function makeMockProvider(id: string, rateType: 'none' | 'per-minute' | 'per-day' = 'none'): QuoteFeedProvider {
  return {
    id,
    displayName: `Mock ${id}`,
    requiresTickerSymbol: false,
    requiresFeedUrl: false,
    requiresFeedProps: [],
    defaultRateLimit: { type: rateType, limit: rateType === 'none' ? 0 : 5 },
    fetchHistorical: vi.fn(async () => ({ prices: [] })),
  };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('registers and retrieves a provider', () => {
    const p = makeMockProvider('TEST');
    registry.register(p);
    expect(registry.get('TEST')).toBe(p);
  });

  it('returns undefined for unknown provider', () => {
    expect(registry.get('UNKNOWN')).toBeUndefined();
  });

  it('lists all registered providers', () => {
    registry.register(makeMockProvider('A'));
    registry.register(makeMockProvider('B'));
    expect(registry.getAll().map(p => p.id)).toEqual(['A', 'B']);
  });

  it('acquirePermit resolves for no-limit provider', async () => {
    registry.register(makeMockProvider('NOLIMIT', 'none'));
    await expect(registry.acquirePermit('NOLIMIT')).resolves.toBeUndefined();
  });

  it('acquirePermit throws for per-day when quota exhausted', async () => {
    const p = makeMockProvider('LIMITED', 'per-day');
    // limit is 5
    registry.register(p);
    // Exhaust quota
    for (let i = 0; i < 5; i++) {
      await registry.acquirePermit('LIMITED');
    }
    await expect(registry.acquirePermit('LIMITED')).rejects.toThrow('Rate limit exceeded');
  });
});
