import { describe, expect, it } from 'vitest';
import { resolveSeriesStatus } from '../use-chart-series';
import type { ResolvedSeries } from '../use-chart-series';

describe('ResolvedSeries shape', () => {
  it('exposes a status discriminator', () => {
    const r: ResolvedSeries = {
      config: { id: 'x', type: 'portfolio', visible: true, lineStyle: 'solid' },
      data: [],
      status: 'empty',
      isLoading: false,
      error: null,
    };
    expect(r.status).toBe('empty');
  });
});

describe('resolveSeriesStatus precedence', () => {
  it.each([
    ['loading', { isLoading: true,  data: undefined, error: null }],
    ['error',   { isLoading: false, data: undefined, error: new Error('boom') }],
    ['empty',   { isLoading: false, data: [],        error: null }],
    ['ok',      { isLoading: false, data: [{ date: '2025-01-01', value: 0.1 }], error: null }],
  ] as const)('maps %s', (expected, q) => {
    expect(resolveSeriesStatus(q)).toBe(expected);
  });

  it('error wins over loading when both are present', () => {
    expect(resolveSeriesStatus({ isLoading: true, data: undefined, error: new Error('x') })).toBe('error');
  });
});
