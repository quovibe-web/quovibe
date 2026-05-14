import { describe, it, expect } from 'vitest';
import { createAccountSchema, updateAccountSchema } from '../schemas/account.schema';

describe('createAccountSchema', () => {
  it('accepts type=account with currency', () => {
    const r = createAccountSchema.parse({ name: 'Cash', type: 'account', currency: 'EUR' });
    expect(r.type).toBe('account');
    expect(r.name).toBe('Cash');
  });

  it('accepts type=portfolio without currency', () => {
    const r = createAccountSchema.parse({ name: 'Brokerage', type: 'portfolio' });
    expect(r.type).toBe('portfolio');
  });

  it('rejects legacy enum vocabulary on the wire (BUG-114)', () => {
    expect(() => createAccountSchema.parse({ name: 'X', type: 'DEPOSIT' })).toThrow();
    expect(() => createAccountSchema.parse({ name: 'X', type: 'SECURITIES' })).toThrow();
  });

  it('rejects unknown type', () => {
    expect(() => createAccountSchema.parse({ name: 'X', type: 'foo' })).toThrow();
  });

  it('rejects blank name (BUG-119)', () => {
    expect(() => createAccountSchema.parse({ name: '   ', type: 'account' })).toThrow();
    expect(() => createAccountSchema.parse({ name: '', type: 'account' })).toThrow();
  });

  it('trims name', () => {
    const r = createAccountSchema.parse({ name: '  Main  ', type: 'account', currency: 'EUR' });
    expect(r.name).toBe('Main');
  });
});

describe('updateAccountSchema', () => {
  it('accepts partial fields', () => {
    const r = updateAccountSchema.parse({ isRetired: true });
    expect(r.isRetired).toBe(true);
  });

  it('rejects blank name on rename', () => {
    expect(() => updateAccountSchema.parse({ name: '   ' })).toThrow();
  });
});
