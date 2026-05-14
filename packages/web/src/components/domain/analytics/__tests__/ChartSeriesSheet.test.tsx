import { describe, expect, it } from 'vitest';
import {
  buildCounterDisplay,
  isAddDisabled,
  MAX_SERIES_SHEET,
  filterSecurities,
  buildAddSeriesPayload,
  type SecurityForFilter,
} from '../chart-series-sheet.utils';

describe('ChartSeriesSheet utils', () => {
  it('exposes MAX_SERIES_SHEET = 10 (matches schema limit)', () => {
    expect(MAX_SERIES_SHEET).toBe(10);
  });

  describe('isAddDisabled', () => {
    it('returns false when below the limit', () => {
      expect(isAddDisabled(0)).toBe(false);
      expect(isAddDisabled(9)).toBe(false);
    });

    it('returns true when at the limit', () => {
      expect(isAddDisabled(10)).toBe(true);
    });

    it('returns true when above the limit (defensive)', () => {
      expect(isAddDisabled(11)).toBe(true);
    });
  });

  describe('buildCounterDisplay', () => {
    it('returns count and max', () => {
      const d = buildCounterDisplay(3);
      expect(d.count).toBe(3);
      expect(d.max).toBe(10);
    });

    it('flags atLimit true when count === max', () => {
      expect(buildCounterDisplay(10).atLimit).toBe(true);
    });

    it('flags atLimit false when count < max', () => {
      expect(buildCounterDisplay(9).atLimit).toBe(false);
    });

    it('flags atLimit true when count > max', () => {
      expect(buildCounterDisplay(15).atLimit).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// filterSecurities — pure helper (Task 3.2)
// ---------------------------------------------------------------------------

const SAMPLE: SecurityForFilter[] = [
  { id: '1', name: 'NVIDIA Corp', ticker: 'NVDA', isin: 'US67066G1040', isRetired: false, isOwned: true },
  { id: '2', name: 'Vanguard FTSE All-World', ticker: 'VWCE', isin: 'IE00BK5BQT80', isRetired: false, isOwned: false },
  { id: '3', name: 'SPDR S&P 500', ticker: 'SPY', isin: 'US78462F1030', isRetired: false, isOwned: false, isIndexLike: true },
  { id: '4', name: 'Tesla Inc', ticker: 'TSLA', isin: 'US88160R1014', isRetired: true, isOwned: true },
  { id: '5', name: 'iShares Core MSCI World', ticker: 'IWDA', isin: 'IE00B4L5Y983', isRetired: false, isOwned: true },
];

describe('filterSecurities', () => {
  it('excludes retired securities from every filter scope', () => {
    expect(filterSecurities(SAMPLE, '', 'all').find((s) => s.id === '4')).toBeUndefined();
    expect(filterSecurities(SAMPLE, '', 'owned').find((s) => s.id === '4')).toBeUndefined();
  });

  it('all: returns all non-retired matching by query', () => {
    expect(filterSecurities(SAMPLE, '', 'all')).toHaveLength(4);
    expect(filterSecurities(SAMPLE, 'nvda', 'all')).toHaveLength(1);
    expect(filterSecurities(SAMPLE, 'NVIDIA', 'all')).toHaveLength(1);
  });

  it('owned: returns only currently-held non-retired securities', () => {
    const owned = filterSecurities(SAMPLE, '', 'owned');
    expect(owned.map((s) => s.id).sort()).toEqual(['1', '5']);
  });

  it('index: returns ISIN-prefix matches AND explicit isIndexLike=true', () => {
    const idx = filterSecurities(SAMPLE, '', 'index');
    expect(idx.map((s) => s.id).sort()).toEqual(['2', '3', '5']);
  });

  it('account: returns empty array (deferred scope)', () => {
    expect(filterSecurities(SAMPLE, '', 'account')).toEqual([]);
  });

  it('search matches by ISIN', () => {
    const r = filterSecurities(SAMPLE, 'IE00BK5', 'all');
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe('2');
  });

  it('search matches case-insensitively', () => {
    expect(filterSecurities(SAMPLE, 'TSLA', 'owned')).toHaveLength(0); // retired
    expect(filterSecurities(SAMPLE, 'spdr', 'index')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildAddSeriesPayload — pure payload builder (Task 3.3)
// ---------------------------------------------------------------------------

describe('buildAddSeriesPayload', () => {
  it('builds a holding (type=security, solid, role=holding)', () => {
    const p = buildAddSeriesPayload('sec-1', 'holding', '#4385BE');
    expect(p.type).toBe('security');
    expect(p.securityId).toBe('sec-1');
    expect(p.lineStyle).toBe('solid');
    expect(p.role).toBe('holding');
    expect(p.color).toBe('#4385BE');
    expect(p.axis).toBe('auto');
    expect(p.visible).toBe(true);
  });

  it('builds a reference (type=benchmark, dashed, role=reference)', () => {
    const p = buildAddSeriesPayload('sec-2', 'reference', '#DA702C');
    expect(p.type).toBe('benchmark');
    expect(p.lineStyle).toBe('dashed');
    expect(p.role).toBe('reference');
  });

  it('generates unique IDs', () => {
    const a = buildAddSeriesPayload('sec', 'holding', '#000000');
    const b = buildAddSeriesPayload('sec', 'holding', '#000000');
    expect(a.id).not.toBe(b.id);
  });
});
