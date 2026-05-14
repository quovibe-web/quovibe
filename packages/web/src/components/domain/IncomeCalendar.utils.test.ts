import { describe, it, expect } from 'vitest';
import {
  computeMonthlyAverages,
  computeYearDelta,
  sparkbarIndex,
  SPARKBAR_GLYPHS,
} from './IncomeCalendar.utils';

describe('computeMonthlyAverages', () => {
  it('averages each month across all years', () => {
    const cells = new Map<number, Map<number, { total: number }>>([
      [2025, new Map([[1, { total: 100 }], [3, { total: 300 }]])],
      [2026, new Map([[1, { total: 200 }], [3, { total: 600 }]])],
    ]);
    const result = computeMonthlyAverages(cells);
    expect(result.averages[0]).toBe((100 + 200) / 2);   // Jan
    expect(result.averages[2]).toBe((300 + 600) / 2);   // Mar
    expect(result.averages[1]).toBe(0);                  // Feb empty
    expect(result.maxAverage).toBe(450);
  });

  it('returns zero map for empty cells', () => {
    const result = computeMonthlyAverages(new Map());
    expect(result.averages[0]).toBe(0);
    expect(result.maxAverage).toBe(0);
    expect(result.averages.length).toBe(12);            // pin length
  });

  it('counts only months with actual data (sparse averaging)', () => {
    // year 2025 has data only in month 1; year 2026 only in month 3
    const cells = new Map<number, Map<number, { total: number }>>([
      [2025, new Map([[1, { total: 100 }]])],
      [2026, new Map([[3, { total: 300 }]])],
    ]);
    const result = computeMonthlyAverages(cells);
    expect(result.averages[0]).toBe(100);   // Jan
    expect(result.averages[2]).toBe(300);   // Mar
  });
});

describe('computeYearDelta', () => {
  it('returns positive delta when year > prior year', () => {
    const yearTotals = new Map([[2025, 7100], [2026, 8742]]);
    expect(computeYearDelta(2026, yearTotals)).toEqual({
      delta: (8742 - 7100) / 7100,
      isUp: true,
    });
  });

  it('returns null when prior year missing', () => {
    const yearTotals = new Map([[2026, 8742]]);
    expect(computeYearDelta(2026, yearTotals)).toBeNull();
  });

  it('returns null when prior year is zero', () => {
    const yearTotals = new Map([[2025, 0], [2026, 8742]]);
    expect(computeYearDelta(2026, yearTotals)).toBeNull();
  });
});

describe('sparkbarIndex', () => {
  it('clamps to highest glyph when value equals max', () => {
    expect(sparkbarIndex(100, 100)).toBe(SPARKBAR_GLYPHS.length - 1);
  });

  it('returns 0 when value is zero', () => {
    expect(sparkbarIndex(0, 100)).toBe(0);
  });

  it('returns 0 when max is zero (avoid div-by-0)', () => {
    expect(sparkbarIndex(50, 0)).toBe(0);
  });

  it('floors to nearest glyph index', () => {
    // 8 glyphs (▁▂▃▄▅▆▇█), index 0..7
    // ratio 0.5 → index 3 (Math.floor(0.5 * 7) = 3)
    expect(sparkbarIndex(50, 100)).toBe(3);
  });
});
