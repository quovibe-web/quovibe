import { describe, it, expect } from 'vitest';
import { normalizeDecimalInput } from './decimal-input';

describe('normalizeDecimalInput', () => {
  it('converts a locale comma decimal to dot form', () => {
    expect(normalizeDecimalInput('1,5')).toBe('1.5');
    expect(normalizeDecimalInput('23,23')).toBe('23.23');
  });

  it('leaves an already-dot value untouched (corruption-safe round-trip)', () => {
    // A dot-form value from the API ("18.18") must NOT be mangled — this is why
    // the helper is a literal comma->dot replace, never an Intl group-strip.
    expect(normalizeDecimalInput('18.18')).toBe('18.18');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeDecimalInput(' 10 ')).toBe('10');
    expect(normalizeDecimalInput('  1,5  ')).toBe('1.5');
  });

  it('does not collapse a grouped value (no thousands grouping)', () => {
    // "1.234,56" -> "1.234.56": deliberately left invalid for the downstream
    // numeric grammar to reject, NOT silently corrected to 1234.56.
    expect(normalizeDecimalInput('1.234,56')).toBe('1.234.56');
  });

  it('does not remove internal whitespace', () => {
    expect(normalizeDecimalInput('1 0')).toBe('1 0');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeDecimalInput('   ')).toBe('');
  });
});
