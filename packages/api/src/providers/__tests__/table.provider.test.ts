import { describe, it, expect } from 'vitest';
import { TableProvider } from '../table.provider';

describe('TableProvider', () => {
  const provider = new TableProvider();

  it('has correct metadata', () => {
    expect(provider.id).toBe('GENERIC_HTML_TABLE');
    expect(provider.requiresTickerSymbol).toBe(false);
    expect(provider.requiresFeedUrl).toBe(true);
    expect(provider.defaultRateLimit.type).toBe('per-minute');
  });

  it('does not implement fetchLatest', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((provider as any).fetchLatest).toBeUndefined();
  });
});
