import { describe, it, expect } from 'vitest';
import { buildAccountsCsv } from '../accounts-export';
import type { AccountListItem } from '@/api/types';

const HEADERS = {
  name: 'Name',
  type: 'Type',
  currency: 'Currency',
  balance: 'Balance',
  transactionCount: 'Transactions',
};

const TYPES = {
  portfolio: 'Portfolio',
  deposit: 'Deposit',
};

function row(over: Partial<AccountListItem>): AccountListItem {
  return {
    id: 'id',
    name: 'Acc',
    type: 'account',
    currency: 'EUR',
    balance: '0',
    isRetired: false,
    transactionCount: 0,
    ...over,
  };
}

describe('buildAccountsCsv', () => {
  it('emits header row and one data row per account', () => {
    const csv = buildAccountsCsv(
      [
        row({ name: 'Main', type: 'portfolio', currency: 'EUR', balance: '1234.56', transactionCount: 12 }),
        row({ name: 'Cash', type: 'account', currency: 'USD', balance: '500', transactionCount: 3 }),
      ],
      HEADERS,
      TYPES,
    );

    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Name,Type,Currency,Balance,Transactions');
    expect(lines[1]).toBe('Main,Portfolio,EUR,1234.56,12');
    expect(lines[2]).toBe('Cash,Deposit,USD,500,3');
  });

  it('prefixes UTF-8 BOM', () => {
    const csv = buildAccountsCsv([], HEADERS, TYPES);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('escapes commas and quotes in account names', () => {
    const csv = buildAccountsCsv(
      [row({ name: 'Smith, John "Q"', type: 'account' })],
      HEADERS,
      TYPES,
    );
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[1]).toBe('"Smith, John ""Q""",Deposit,EUR,0,0');
  });

  it('emits empty cell for null currency', () => {
    const csv = buildAccountsCsv(
      [row({ name: 'X', type: 'portfolio', currency: null })],
      HEADERS,
      TYPES,
    );
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[1]).toBe('X,Portfolio,,0,0');
  });

  it('resolves type label per row', () => {
    const csv = buildAccountsCsv(
      [
        row({ name: 'P', type: 'portfolio' }),
        row({ name: 'D', type: 'account' }),
      ],
      HEADERS,
      { portfolio: 'Portafoglio', deposit: 'Deposito' },
    );
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[1]).toContain('Portafoglio');
    expect(lines[2]).toContain('Deposito');
  });

  it('produces only the header row when accounts is empty', () => {
    const csv = buildAccountsCsv([], HEADERS, TYPES);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines).toEqual(['Name,Type,Currency,Balance,Transactions']);
  });
});
