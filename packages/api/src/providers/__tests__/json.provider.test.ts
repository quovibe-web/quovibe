import { describe, it, expect } from 'vitest';
import { JsonProvider } from '../json.provider';

describe('JsonProvider', () => {
  const provider = new JsonProvider();

  it('has correct metadata', () => {
    expect(provider.id).toBe('GENERIC-JSON');
    expect(provider.requiresTickerSymbol).toBe(false);
    expect(provider.requiresFeedUrl).toBe(true);
    expect(provider.requiresFeedProps).toEqual(['GENERIC-JSON-DATE', 'GENERIC-JSON-CLOSE']);
    expect(provider.defaultRateLimit.type).toBe('per-minute');
  });

  it('does not implement fetchLatest', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((provider as any).fetchLatest).toBeUndefined();
  });
});
