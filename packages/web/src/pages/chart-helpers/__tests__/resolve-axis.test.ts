import { describe, expect, it } from 'vitest';
import { resolveAxis } from '../resolve-axis';
import type { ResolvedSeries } from '@/api/use-chart-series';
import type { DataSeriesConfigV3 } from '@quovibe/shared';

function mkSeries(
  id: string,
  rangeMagnitude: number,
  status: ResolvedSeries['status'] = 'ok',
  axis: 'left' | 'right' | 'auto' = 'auto',
): ResolvedSeries {
  const config: DataSeriesConfigV3 = {
    id,
    type: 'security',
    securityId: 'sec',
    visible: true,
    lineStyle: 'solid',
    axis,
    role: 'holding',
  };
  // Construct data with range = rangeMagnitude (min=0, max=rangeMagnitude)
  const data = rangeMagnitude > 0
    ? [{ date: '2025-01-01', value: 0 }, { date: '2026-01-01', value: rangeMagnitude }]
    : [];
  return { config, data, status, isLoading: false, error: null };
}

function mkPortfolio(rangeMagnitude: number, status: ResolvedSeries['status'] = 'ok'): ResolvedSeries {
  const config: DataSeriesConfigV3 = {
    id: 'portfolio-default',
    type: 'portfolio',
    visible: true,
    lineStyle: 'solid',
    axis: 'auto',
    role: 'portfolio',
  };
  const data = rangeMagnitude > 0
    ? [{ date: '2025-01-01', value: 0 }, { date: '2026-01-01', value: rangeMagnitude }]
    : [];
  return { config, data, status, isLoading: false, error: null };
}

describe('resolveAxis', () => {
  const portfolio = mkPortfolio(0.4);

  it('returns explicit "left" when config.axis is "left"', () => {
    expect(resolveAxis(mkSeries('a', 0.5, 'ok', 'left'), portfolio)).toBe('left');
    // Even when range would auto-pick right (5 > 2 * 0.4)
    expect(resolveAxis(mkSeries('a', 5, 'ok', 'left'), portfolio)).toBe('left');
  });

  it('returns explicit "right" when config.axis is "right"', () => {
    expect(resolveAxis(mkSeries('a', 0.5, 'ok', 'right'), portfolio)).toBe('right');
    // Even when range is tiny (would otherwise auto-pick left)
    expect(resolveAxis(mkSeries('a', 0.01, 'ok', 'right'), portfolio)).toBe('right');
  });

  it('portfolio-default always returns left', () => {
    expect(resolveAxis(portfolio, portfolio)).toBe('left');
  });

  it('non-ok status returns left (defensive default)', () => {
    expect(resolveAxis(mkSeries('a', 5, 'empty'), portfolio)).toBe('left');
    expect(resolveAxis(mkSeries('a', 5, 'loading'), portfolio)).toBe('left');
    expect(resolveAxis(mkSeries('a', 5, 'error'), portfolio)).toBe('left');
  });

  it('returns left when portfolio status is not ok', () => {
    const sickPortfolio = mkPortfolio(0.4, 'error');
    expect(resolveAxis(mkSeries('a', 5), sickPortfolio)).toBe('left');
  });

  it('returns left when portfolio range is zero', () => {
    const flatPortfolio = mkPortfolio(0);
    expect(resolveAxis(mkSeries('a', 5), flatPortfolio)).toBe('left');
  });

  it('returns right when series range exceeds 2x portfolio range', () => {
    expect(resolveAxis(mkSeries('a', 1.0), portfolio)).toBe('right'); // 1.0 > 2 * 0.4 = 0.8
    expect(resolveAxis(mkSeries('a', 2.0), portfolio)).toBe('right');
  });

  it('returns left when series range is at or below 2x portfolio range', () => {
    expect(resolveAxis(mkSeries('a', 0.8), portfolio)).toBe('left'); // exactly 2x — strict >
    expect(resolveAxis(mkSeries('a', 0.5), portfolio)).toBe('left');
    expect(resolveAxis(mkSeries('a', 0.1), portfolio)).toBe('left');
  });

  it('handles negative ranges symmetrically (range = max - min)', () => {
    // Build a series that goes from -1 to +1 (range = 2)
    const swingingConfig: DataSeriesConfigV3 = {
      id: 'a', type: 'security', securityId: 'sec',
      visible: true, lineStyle: 'solid', axis: 'auto', role: 'holding',
    };
    const swingingSeries: ResolvedSeries = {
      config: swingingConfig,
      data: [
        { date: '2025-01-01', value: -1 },
        { date: '2025-06-01', value: 0 },
        { date: '2026-01-01', value: 1 },
      ],
      status: 'ok', isLoading: false, error: null,
    };
    expect(resolveAxis(swingingSeries, portfolio)).toBe('right'); // 2 > 0.8
  });
});
