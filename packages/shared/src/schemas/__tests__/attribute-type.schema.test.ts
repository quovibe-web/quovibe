import { describe, it, expect } from 'vitest';
import {
  createAttributeTypeSchema,
  updateAttributeTypeSchema,
} from '../attribute-type.schema';

describe('createAttributeTypeSchema', () => {
  it('accepts minimal valid create input', () => {
    const r = createAttributeTypeSchema.safeParse({ name: 'Sector', friendlyType: 'TEXT' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys (strict mode)', () => {
    const r = createAttributeTypeSchema.safeParse({
      name: 'Sector', friendlyType: 'TEXT', extra: 1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown friendlyType', () => {
    const r = createAttributeTypeSchema.safeParse({ name: 'Sector', friendlyType: 'GARBAGE' });
    expect(r.success).toBe(false);
  });

  it('rejects empty name after trim', () => {
    const r = createAttributeTypeSchema.safeParse({ name: '   ', friendlyType: 'TEXT' });
    expect(r.success).toBe(false);
  });

  it('accepts optional columnLabel + target', () => {
    const r = createAttributeTypeSchema.safeParse({
      name: 'Sector', columnLabel: 'Sec', friendlyType: 'TEXT', target: 'Security',
    });
    expect(r.success).toBe(true);
  });
});

describe('updateAttributeTypeSchema', () => {
  it('accepts name-only update', () => {
    const r = updateAttributeTypeSchema.safeParse({ name: 'Risk Rating' });
    expect(r.success).toBe(true);
  });

  it('rejects friendlyType in update body (PP rule: no type change)', () => {
    const r = updateAttributeTypeSchema.safeParse({ name: 'X', friendlyType: 'NUMBER' });
    expect(r.success).toBe(false);
  });

  it('rejects target in update body', () => {
    const r = updateAttributeTypeSchema.safeParse({ name: 'X', target: 'Security' });
    expect(r.success).toBe(false);
  });
});
