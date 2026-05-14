import { describe, it, expect } from 'vitest';
import {
  computeYoYDelta,
  formatPeakLabel,
  computeAverageDelta,
} from './IncomeHero.utils';

describe('computeYoYDelta', () => {
  it('returns positive ratio when current > prior', () => {
    expect(computeYoYDelta(8742, 7776)).toEqual({
      delta: (8742 - 7776) / 7776,
      isUp: true,
      priorTotal: 7776,
    });
  });

  it('returns negative ratio when current < prior', () => {
    expect(computeYoYDelta(6000, 7776)).toEqual({
      delta: (6000 - 7776) / 7776,
      isUp: false,
      priorTotal: 7776,
    });
  });

  it('returns null when prior is zero (suppresses chip per spec edge case)', () => {
    expect(computeYoYDelta(8742, 0)).toBeNull();
  });

  it('returns null when prior is null (data unavailable)', () => {
    expect(computeYoYDelta(8742, null)).toBeNull();
  });
});

describe('formatPeakLabel', () => {
  it('renders bucket as "MMM yyyy" using provided shorts', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    expect(formatPeakLabel('2026-03', months)).toBe('Mar 2026');
  });

  it('returns the raw bucket when not a yyyy-MM format', () => {
    expect(formatPeakLabel('2026-Q1', [])).toBe('2026-Q1');
  });

  it('handles missing month entry gracefully', () => {
    expect(formatPeakLabel('2026-03', [])).toBe(' 2026');
  });
});

describe('computeAverageDelta', () => {
  it('current avg/month vs prior avg/month, signed', () => {
    expect(computeAverageDelta(728, 12, 639, 12)).toEqual({
      delta: 728 / 12 - 639 / 12,
      isUp: true,
    });
  });

  it('handles zero prior months', () => {
    expect(computeAverageDelta(728, 12, 0, 0)).toBeNull();
  });

  it('returns null when prior total is null', () => {
    expect(computeAverageDelta(728, 12, null, 12)).toBeNull();
  });

  it('uses per-month averages, not raw totals (unequal month counts)', () => {
    // current YTD partial period: 6 months, total 600 → avg 100/mo
    // prior full year: 12 months, total 600 → avg 50/mo
    // delta should be 100 - 50 = 50, NOT 600 - 600 = 0
    expect(computeAverageDelta(600, 6, 600, 12)).toEqual({ delta: 50, isUp: true });
  });

  it('returns null when currentMonths is zero', () => {
    expect(computeAverageDelta(0, 0, 100, 12)).toBeNull();
  });
});
