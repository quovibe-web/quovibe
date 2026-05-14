import { describe, it, expect } from 'vitest';
import {
  initialPriceWizardState,
  priceWizardReducer,
  canAdvance,
  type PriceWizardState,
} from '../price-import-wizard.utils';
import type { CsvParseResult } from '@quovibe/shared';

const sampleParseResult: CsvParseResult = {
  tempFileId: 'tmp-1',
  headers: ['Date', 'Close'],
  sampleRows: [['2025-01-02', '101.5']],
  totalRows: 1,
  detectedDelimiter: ',',
};

describe('priceWizardReducer', () => {
  it('initial state starts on the security step', () => {
    expect(initialPriceWizardState.step).toBe('security');
    expect(initialPriceWizardState.securityId).toBeNull();
    expect(initialPriceWizardState.parseResult).toBeNull();
  });

  it('pickSecurity stores the chosen id and name', () => {
    const next = priceWizardReducer(initialPriceWizardState, {
      type: 'pickSecurity',
      securityId: 'SEC_A',
      securityName: 'Apple Inc.',
    });
    expect(next.securityId).toBe('SEC_A');
    expect(next.securityName).toBe('Apple Inc.');
  });

  it('next advances security → upload → map → confirm', () => {
    let s: PriceWizardState = { ...initialPriceWizardState, securityId: 'SEC_A' };
    s = priceWizardReducer(s, { type: 'next' });
    expect(s.step).toBe('upload');
    s = priceWizardReducer(s, { type: 'next' });
    expect(s.step).toBe('map');
    s = priceWizardReducer(s, { type: 'next' });
    expect(s.step).toBe('confirm');
    s = priceWizardReducer(s, { type: 'next' });
    expect(s.step).toBe('confirm');
  });

  it('back walks the path in reverse', () => {
    let s: PriceWizardState = { ...initialPriceWizardState, step: 'confirm' };
    s = priceWizardReducer(s, { type: 'back' });
    expect(s.step).toBe('map');
    s = priceWizardReducer(s, { type: 'back' });
    expect(s.step).toBe('upload');
    s = priceWizardReducer(s, { type: 'back' });
    expect(s.step).toBe('security');
    s = priceWizardReducer(s, { type: 'back' });
    expect(s.step).toBe('security');
  });

  it('setParseResult stores the result and auto-mapped columns', () => {
    const next = priceWizardReducer(initialPriceWizardState, {
      type: 'setParseResult',
      parseResult: sampleParseResult,
      columnMapping: { date: 0, close: 1 },
    });
    expect(next.parseResult).toBe(sampleParseResult);
    expect(next.columnMapping).toEqual({ date: 0, close: 1 });
  });

  it('setColumnMapping replaces the columnMapping without touching other state', () => {
    const seeded: PriceWizardState = {
      ...initialPriceWizardState,
      parseResult: sampleParseResult,
      columnMapping: { date: 0, close: 1 },
    };
    const next = priceWizardReducer(seeded, {
      type: 'setColumnMapping',
      columnMapping: { date: 2, close: 3, high: 4 },
    });
    expect(next.columnMapping).toEqual({ date: 2, close: 3, high: 4 });
    expect(next.parseResult).toBe(sampleParseResult);
  });

  it('clearParseResult resets parseResult and columnMapping', () => {
    const seeded: PriceWizardState = {
      ...initialPriceWizardState,
      parseResult: sampleParseResult,
      columnMapping: { date: 0, close: 1 },
    };
    const next = priceWizardReducer(seeded, { type: 'clearParseResult' });
    expect(next.parseResult).toBeNull();
    expect(next.columnMapping).toEqual({});
  });

  it('setFormat updates only the provided keys', () => {
    const next = priceWizardReducer(initialPriceWizardState, {
      type: 'setFormat',
      decimalSeparator: ',',
    });
    expect(next.decimalSeparator).toBe(',');
    expect(next.dateFormat).toBe(initialPriceWizardState.dateFormat);
    expect(next.thousandSeparator).toBe(initialPriceWizardState.thousandSeparator);
  });
});

describe('canAdvance', () => {
  it('security: requires securityId', () => {
    expect(canAdvance(initialPriceWizardState)).toBe(false);
    expect(canAdvance({ ...initialPriceWizardState, securityId: 'SEC_A' })).toBe(true);
  });

  it('upload: requires parseResult', () => {
    const base = { ...initialPriceWizardState, step: 'upload' as const, securityId: 'SEC_A' };
    expect(canAdvance(base)).toBe(false);
    expect(canAdvance({ ...base, parseResult: sampleParseResult })).toBe(true);
  });

  it('map: requires date and close columns mapped', () => {
    const base: PriceWizardState = {
      ...initialPriceWizardState,
      step: 'map',
      securityId: 'SEC_A',
      parseResult: sampleParseResult,
    };
    expect(canAdvance(base)).toBe(false);
    expect(canAdvance({ ...base, columnMapping: { date: 0 } })).toBe(false);
    expect(canAdvance({ ...base, columnMapping: { date: 0, close: 1 } })).toBe(true);
  });

  it('confirm: always true', () => {
    expect(canAdvance({ ...initialPriceWizardState, step: 'confirm' })).toBe(true);
  });
});
