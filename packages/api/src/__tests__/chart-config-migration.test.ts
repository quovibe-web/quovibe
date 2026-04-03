import { describe, it, expect } from 'vitest';
import {
  migrateChartConfigV1toV2,
  chartConfigV2Schema,
  DEFAULT_CHART_CONFIG,
} from '@quovibe/shared';

describe('ChartConfig v1 → v2 migration', () => {
  it('migrates empty v1 config to v2 with default portfolio series', () => {
    const v2 = migrateChartConfigV1toV2({ benchmarks: [] });
    expect(v2.version).toBe(2);
    expect(v2.series).toHaveLength(1);
    expect(v2.series[0].type).toBe('portfolio');
    expect(v2.series[0].visible).toBe(true);
    expect(v2.series[0].lineStyle).toBe('solid');
  });

  it('preserves benchmarks as benchmark series with dashed lines', () => {
    const v2 = migrateChartConfigV1toV2({
      benchmarks: [
        { securityId: 'sec-1', color: '#ff0000' },
        { securityId: 'sec-2' },
      ],
    });
    expect(v2.series).toHaveLength(3); // 1 portfolio + 2 benchmarks
    expect(v2.series[0].type).toBe('portfolio');

    const bm1 = v2.series[1];
    expect(bm1.type).toBe('benchmark');
    expect(bm1.securityId).toBe('sec-1');
    expect(bm1.color).toBe('#ff0000');
    expect(bm1.lineStyle).toBe('dashed');
    expect(bm1.visible).toBe(true);

    const bm2 = v2.series[2];
    expect(bm2.type).toBe('benchmark');
    expect(bm2.securityId).toBe('sec-2');
    expect(bm2.color).toBeNull();
  });

  it('handles undefined benchmarks array', () => {
    const v2 = migrateChartConfigV1toV2({});
    expect(v2.version).toBe(2);
    expect(v2.series).toHaveLength(1);
    expect(v2.series[0].type).toBe('portfolio');
  });

  it('generates unique IDs for each benchmark series', () => {
    const v2 = migrateChartConfigV1toV2({
      benchmarks: [
        { securityId: 'a' },
        { securityId: 'b' },
        { securityId: 'c' },
      ],
    });
    const ids = v2.series.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('migrated config passes v2 schema validation', () => {
    const v2 = migrateChartConfigV1toV2({
      benchmarks: [{ securityId: 'sec-1', color: '#abcdef' }],
    });
    const result = chartConfigV2Schema.safeParse(v2);
    expect(result.success).toBe(true);
  });

  it('DEFAULT_CHART_CONFIG passes v2 schema validation', () => {
    const result = chartConfigV2Schema.safeParse(DEFAULT_CHART_CONFIG);
    expect(result.success).toBe(true);
  });
});

describe('ChartConfigV2 schema validation', () => {
  it('rejects series without securityId when type is security', () => {
    const result = chartConfigV2Schema.safeParse({
      version: 2,
      series: [{ id: 'x', type: 'security', visible: true, lineStyle: 'solid' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects series without securityId when type is benchmark', () => {
    const result = chartConfigV2Schema.safeParse({
      version: 2,
      series: [{ id: 'x', type: 'benchmark', visible: true, lineStyle: 'solid' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects series without accountId when type is account', () => {
    const result = chartConfigV2Schema.safeParse({
      version: 2,
      series: [{ id: 'x', type: 'account', visible: true, lineStyle: 'solid' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid portfolio series without securityId/accountId', () => {
    const result = chartConfigV2Schema.safeParse({
      version: 2,
      series: [{ id: 'x', type: 'portfolio', visible: true, lineStyle: 'solid' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 10 series', () => {
    const series = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      type: 'portfolio' as const,
      visible: true,
      lineStyle: 'solid' as const,
    }));
    const result = chartConfigV2Schema.safeParse({ version: 2, series });
    expect(result.success).toBe(false);
  });

  it('rejects invalid hex color', () => {
    const result = chartConfigV2Schema.safeParse({
      version: 2,
      series: [{ id: 'x', type: 'portfolio', visible: true, lineStyle: 'solid', color: 'red' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts null color (auto palette)', () => {
    const result = chartConfigV2Schema.safeParse({
      version: 2,
      series: [{ id: 'x', type: 'portfolio', visible: true, lineStyle: 'solid', color: null }],
    });
    expect(result.success).toBe(true);
  });
});
