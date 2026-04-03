import { describe, it, expect } from 'vitest';
import { normalizeInstrumentType } from '../instrument-type';

describe('normalizeInstrumentType', () => {
  it('maps EQUITY to EQUITY', () => {
    expect(normalizeInstrumentType('EQUITY')).toBe('EQUITY');
  });

  it('maps ETF to ETF', () => {
    expect(normalizeInstrumentType('ETF')).toBe('ETF');
  });

  it('maps CRYPTOCURRENCY to CRYPTO', () => {
    expect(normalizeInstrumentType('CRYPTOCURRENCY')).toBe('CRYPTO');
  });

  it('maps MUTUALFUND to FUND', () => {
    expect(normalizeInstrumentType('MUTUALFUND')).toBe('FUND');
  });

  it('maps FUTURE to COMMODITY', () => {
    expect(normalizeInstrumentType('FUTURE')).toBe('COMMODITY');
  });

  it('maps COMMODITY to COMMODITY', () => {
    expect(normalizeInstrumentType('COMMODITY')).toBe('COMMODITY');
  });

  it('maps INDEX to INDEX', () => {
    expect(normalizeInstrumentType('INDEX')).toBe('INDEX');
  });

  it('maps CURRENCY to CURRENCY', () => {
    expect(normalizeInstrumentType('CURRENCY')).toBe('CURRENCY');
  });

  it('maps BOND to BOND', () => {
    expect(normalizeInstrumentType('BOND')).toBe('BOND');
  });

  it('maps OPTION to EQUITY', () => {
    expect(normalizeInstrumentType('OPTION')).toBe('EQUITY');
  });

  it('is case-insensitive', () => {
    expect(normalizeInstrumentType('equity')).toBe('EQUITY');
    expect(normalizeInstrumentType('Etf')).toBe('ETF');
    expect(normalizeInstrumentType('cryptocurrency')).toBe('CRYPTO');
  });

  it('returns UNKNOWN for unmapped types', () => {
    expect(normalizeInstrumentType('WARRANT')).toBe('UNKNOWN');
    expect(normalizeInstrumentType('')).toBe('UNKNOWN');
    expect(normalizeInstrumentType('FOOBAR')).toBe('UNKNOWN');
  });
});
