import { describe, it, expect } from 'vitest';
import {
  computeSegmentWidths,
  computeRemainderWidth,
  resolveColor,
  FALLBACK_COLOR,
} from '../SplitBar';

describe('SplitBar — computeSegmentWidths', () => {
  it('returns an empty array when given no segments', () => {
    expect(computeSegmentWidths([])).toEqual([]);
  });

  it('returns 100% for a single segment with weight 10000', () => {
    const result = computeSegmentWidths([
      { categoryName: 'Tech', color: '#8fb4e0', weight: 10000 },
    ]);
    expect(result).toEqual(['100.00%']);
  });

  it('returns 60% and 40% for a 6000/4000 split', () => {
    const result = computeSegmentWidths([
      { categoryName: 'Tech', color: '#8fb4e0', weight: 6000 },
      { categoryName: 'Healthcare', color: '#e0a08f', weight: 4000 },
    ]);
    expect(result).toEqual(['60.00%', '40.00%']);
  });

  it('returns 60% for a single segment with weight 6000 (partial assignment)', () => {
    const result = computeSegmentWidths([
      { categoryName: 'Tech', color: '#8fb4e0', weight: 6000 },
    ]);
    expect(result).toEqual(['60.00%']);
  });
});

describe('SplitBar — computeRemainderWidth', () => {
  it('returns null when weights sum to exactly 10000', () => {
    expect(computeRemainderWidth([
      { categoryName: 'Tech', color: '#8fb4e0', weight: 10000 },
    ])).toBeNull();
  });

  it('returns "40.00%" when total weight is 6000', () => {
    expect(computeRemainderWidth([
      { categoryName: 'Tech', color: '#8fb4e0', weight: 6000 },
    ])).toBe('40.00%');
  });

  it('returns null when multiple segments sum to 10000', () => {
    expect(computeRemainderWidth([
      { categoryName: 'Tech', color: '#8fb4e0', weight: 6000 },
      { categoryName: 'Healthcare', color: '#e0a08f', weight: 4000 },
    ])).toBeNull();
  });

  it('returns "20.00%" when two segments sum to 8000', () => {
    expect(computeRemainderWidth([
      { categoryName: 'Tech', color: '#8fb4e0', weight: 5000 },
      { categoryName: 'Healthcare', color: '#e0a08f', weight: 3000 },
    ])).toBe('20.00%');
  });
});

describe('SplitBar — resolveColor', () => {
  it('returns the provided color string when not null', () => {
    expect(resolveColor('#8fb4e0')).toBe('#8fb4e0');
  });

  it('returns FALLBACK_COLOR when color is null', () => {
    expect(resolveColor(null)).toBe(FALLBACK_COLOR);
  });
});

