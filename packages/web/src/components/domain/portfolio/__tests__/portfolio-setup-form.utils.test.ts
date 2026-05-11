import { describe, it, expect } from 'vitest';
import {
  findDuplicateDepositNames,
  buildSetupInput,
} from '../portfolio-setup-form.utils';

describe('findDuplicateDepositNames', () => {
  it('returns empty when all names are unique', () => {
    expect(findDuplicateDepositNames(['Cash', 'USD Cash', 'GBP Cash'])).toEqual([]);
  });

  it('detects case-insensitive duplicates', () => {
    expect(findDuplicateDepositNames(['Cash', 'cash'])).toEqual(['cash']);
  });

  it('detects whitespace-variant duplicates', () => {
    expect(findDuplicateDepositNames(['Cash', '  Cash  '])).toEqual(['cash']);
  });

  it('ignores blank / whitespace-only entries', () => {
    expect(findDuplicateDepositNames(['', '   ', 'Cash'])).toEqual([]);
  });

  it('reports each duplicate exactly once', () => {
    expect(findDuplicateDepositNames(['Cash', 'USD Cash', 'Cash'])).toEqual(['cash']);
  });

  it('reports multiple distinct duplicates', () => {
    expect(
      findDuplicateDepositNames(['Cash', 'EUR', 'Cash', 'eur', 'GBP']),
    ).toEqual(['cash', 'eur']);
  });
});

describe('buildSetupInput', () => {
  it('normalises a minimal form payload', () => {
    expect(
      buildSetupInput({
        baseCurrency: 'EUR',
        securitiesAccountName: 'Main Securities',
        primaryDeposit: { name: 'Cash' },
      }),
    ).toEqual({
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
      extraDeposits: [],
    });
  });

  it('trims whitespace on primary and extra deposit names', () => {
    expect(
      buildSetupInput({
        baseCurrency: 'EUR',
        securitiesAccountName: '  Main Securities  ',
        primaryDeposit: { name: '  EUR Cash  ' },
        extraDeposits: [
          { name: '  USD Cash  ', currency: 'USD' },
          { name: ' GBP Cash ', currency: 'GBP' },
        ],
      }),
    ).toEqual({
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'EUR Cash' },
      extraDeposits: [
        { name: 'USD Cash', currency: 'USD' },
        { name: 'GBP Cash', currency: 'GBP' },
      ],
    });
  });

  it('defaults missing extraDeposits to an empty array', () => {
    const result = buildSetupInput({
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main',
      primaryDeposit: { name: 'Cash' },
    });
    expect(result.extraDeposits).toEqual([]);
  });

  it('passes currency through verbatim (schema regex validates at the wire)', () => {
    const result = buildSetupInput({
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main',
      primaryDeposit: { name: 'Cash' },
      extraDeposits: [{ name: 'X', currency: 'usd' }],
    });
    expect(result.extraDeposits[0].currency).toBe('usd');
  });
});
