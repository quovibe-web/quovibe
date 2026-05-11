import { describe, it, expect } from 'vitest';
import { updateCategorySchema } from '../schemas/taxonomy.schema';

describe('updateCategorySchema — strict mode (BUG-168)', () => {
  it('accepts a known field (rename)', () => {
    const result = updateCategorySchema.safeParse({ name: 'Equities' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty object (no-op patch)', () => {
    const result = updateCategorySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects unknown `weight` field — must use the /allocation endpoint instead', () => {
    const result = updateCategorySchema.safeParse({ weight: 7777 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i => i.code === 'unrecognized_keys');
      expect(issue, 'expected an unrecognized_keys issue').toBeDefined();
    }
  });

  it('rejects unknown arbitrary fields', () => {
    const result = updateCategorySchema.safeParse({ name: 'Equities', wat: 1 });
    expect(result.success).toBe(false);
  });
});
