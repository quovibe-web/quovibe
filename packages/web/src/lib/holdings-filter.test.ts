import { describe, it, expect } from 'vitest';
import { filterByHoldings } from './holdings-filter';

type Row = { id: string; shares?: string | null };

const rows: Row[] = [
  { id: 'pos', shares: '1.5' },
  { id: 'zeroStr', shares: '0' },
  { id: 'zeroPad', shares: '0.00000000' },
  { id: 'nullShares', shares: null },
  { id: 'missing' },
];

describe('filterByHoldings', () => {
  it('all returns every row unchanged (same reference)', () => {
    expect(filterByHoldings(rows, 'all')).toBe(rows);
  });

  it('held keeps only strictly-positive shares', () => {
    expect(filterByHoldings(rows, 'held').map((r) => r.id)).toEqual(['pos']);
  });

  it('exited keeps zero / null / missing shares', () => {
    expect(filterByHoldings(rows, 'exited').map((r) => r.id)).toEqual([
      'zeroStr',
      'zeroPad',
      'nullShares',
      'missing',
    ]);
  });

  it('held and exited partition the input (exactly one side per row, no overlap)', () => {
    const held = new Set(filterByHoldings(rows, 'held').map((r) => r.id));
    const exited = new Set(filterByHoldings(rows, 'exited').map((r) => r.id));
    for (const r of rows) {
      expect(held.has(r.id) !== exited.has(r.id)).toBe(true);
    }
    expect(held.size + exited.size).toBe(rows.length);
  });
});
