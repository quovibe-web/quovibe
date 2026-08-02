import { describe, it, expect } from 'vitest';
import { createSecurityEventSchema } from './security-event.schema';
import { SecurityEventType } from '../enums';

const base = {
  securityId: '11111111-1111-4111-8111-111111111111',
  type: SecurityEventType.STOCK_SPLIT,
  date: '2026-07-16',
};

describe('createSecurityEventSchema — STOCK_SPLIT details', () => {
  it('accepts the plain new:old storage format', () => {
    expect(() => createSecurityEventSchema.parse({ ...base, details: '1:25' })).not.toThrow();
  });

  it('accepts a fractional ratio', () => {
    expect(() => createSecurityEventSchema.parse({ ...base, details: '2.1796:1' })).not.toThrow();
  });

  it('still accepts the legacy JSON shape', () => {
    expect(() =>
      createSecurityEventSchema.parse({ ...base, details: '{"splitRatio":"1:25"}' }),
    ).not.toThrow();
  });

  it('rejects details that are neither a ratio nor JSON', () => {
    expect(() =>
      createSecurityEventSchema.parse({ ...base, details: 'one for twenty-five' }),
    ).toThrow();
  });

  it('leaves non-split events unconstrained', () => {
    expect(() =>
      createSecurityEventSchema.parse({
        ...base,
        type: SecurityEventType.NOTE,
        details: 'anything goes',
      }),
    ).not.toThrow();
  });
});
