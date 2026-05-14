import { describe, it, expect } from 'vitest';
import { filterSecurities, type PickerSecurity } from '../security-picker.utils';

const SECS: PickerSecurity[] = [
  { id: 'A', name: 'Apple Inc.', ticker: 'AAPL', isin: 'US0378331005', isRetired: false },
  { id: 'M', name: 'Microsoft', ticker: 'MSFT', isin: 'US5949181045', isRetired: false },
  { id: 'X', name: 'Old Position', ticker: null, isin: null, isRetired: true },
];

describe('filterSecurities', () => {
  it('returns all when query is empty', () => {
    expect(filterSecurities(SECS, '').map((s) => s.id)).toEqual(['A', 'M', 'X']);
  });

  it('returns all when query is whitespace', () => {
    expect(filterSecurities(SECS, '   ').map((s) => s.id)).toEqual(['A', 'M', 'X']);
  });

  it('matches by name substring case-insensitive', () => {
    expect(filterSecurities(SECS, 'apple').map((s) => s.id)).toEqual(['A']);
    expect(filterSecurities(SECS, 'MICRO').map((s) => s.id)).toEqual(['M']);
  });

  it('matches by ticker', () => {
    expect(filterSecurities(SECS, 'aapl').map((s) => s.id)).toEqual(['A']);
  });

  it('matches by ISIN', () => {
    expect(filterSecurities(SECS, '5949').map((s) => s.id)).toEqual(['M']);
  });

  it('includes retired securities when matched', () => {
    expect(filterSecurities(SECS, 'old').map((s) => s.id)).toEqual(['X']);
  });

  it('ignores null ticker/isin fields', () => {
    expect(filterSecurities(SECS, 'msft').map((s) => s.id)).toEqual(['M']);
  });
});
