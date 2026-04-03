import { describe, it, expect } from 'vitest';
import { createSecuritySchema } from '../schemas/security.schema';

describe('createSecuritySchema', () => {
  it('accepts calendar field', () => {
    const result = createSecuritySchema.parse({
      name: 'Test Security',
      currency: 'EUR',
      calendar: 'NYSE',
    });
    expect(result.calendar).toBe('NYSE');
  });

  it('accepts isRetired field', () => {
    const result = createSecuritySchema.parse({
      name: 'Test',
      currency: 'EUR',
      isRetired: true,
    });
    expect(result.isRetired).toBe(true);
  });

  it('rejects empty name', () => {
    expect(() =>
      createSecuritySchema.parse({ name: '', currency: 'EUR' })
    ).toThrow();
  });
});
