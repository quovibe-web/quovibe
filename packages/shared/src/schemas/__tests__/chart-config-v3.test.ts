import { describe, expect, it } from 'vitest';
import {
  migrateChartConfigV2toV3,
  chartConfigV3Schema,
  dataSeriesConfigV3Schema,
  type ChartConfigV2,
  type ChartConfigV3,
} from '../benchmark.schema';

describe('chart-config v3 schema', () => {
  it('migrates v2 series to v3 with derived role and default axis=auto', () => {
    const v2: ChartConfigV2 = {
      version: 2,
      series: [
        { id: 'portfolio-default', type: 'portfolio', visible: true, lineStyle: 'solid' },
        { id: 'a1', type: 'security', securityId: 'sec1', visible: true, lineStyle: 'solid' },
        { id: 'a2', type: 'benchmark', securityId: 'sec2', visible: true, lineStyle: 'dashed' },
        { id: 'a3', type: 'account', accountId: 'acc1', visible: true, lineStyle: 'solid' },
      ],
    };
    const v3 = migrateChartConfigV2toV3(v2);
    expect(v3.version).toBe(3);
    expect(v3.series[0]?.role).toBe('portfolio');
    expect(v3.series[1]?.role).toBe('holding');
    expect(v3.series[2]?.role).toBe('reference');
    expect(v3.series[3]?.role).toBe('holding'); // accounts are holdings
    expect(v3.series.every(s => s.axis === 'auto')).toBe(true);
  });

  it('preserves existing fields during migration (id, type, color, label, areaFill, order)', () => {
    const v2: ChartConfigV2 = {
      version: 2,
      series: [
        {
          id: 'x', type: 'security', securityId: 'sec1', visible: false,
          lineStyle: 'dotted', color: '#abcdef', label: 'my label',
          areaFill: true, order: 5,
        },
      ],
    };
    const v3 = migrateChartConfigV2toV3(v2);
    const s = v3.series[0];
    expect(s).toMatchObject({
      id: 'x',
      type: 'security',
      securityId: 'sec1',
      visible: false,
      lineStyle: 'dotted',
      color: '#abcdef',
      label: 'my label',
      areaFill: true,
      order: 5,
    });
  });

  it('passes v3 Zod validation with explicit axis and role', () => {
    const v3: ChartConfigV3 = {
      version: 3,
      series: [
        {
          id: 'p', type: 'portfolio', visible: true, lineStyle: 'solid',
          axis: 'left', role: 'portfolio',
        },
        {
          id: 'b', type: 'benchmark', securityId: 'sec1', visible: true, lineStyle: 'dashed',
          axis: 'right', role: 'reference',
        },
      ],
    };
    expect(() => chartConfigV3Schema.parse(v3)).not.toThrow();
  });

  it('defaults axis to "auto" when omitted', () => {
    const parsed = dataSeriesConfigV3Schema.parse({
      id: 'a', type: 'portfolio', visible: true, lineStyle: 'solid',
    });
    expect(parsed.axis).toBe('auto');
  });

  it('rejects invalid axis values', () => {
    expect(() => dataSeriesConfigV3Schema.parse({
      id: 'a', type: 'portfolio', visible: true, lineStyle: 'solid',
      axis: 'top',
    })).toThrow();
  });

  it('rejects invalid role values', () => {
    expect(() => dataSeriesConfigV3Schema.parse({
      id: 'a', type: 'portfolio', visible: true, lineStyle: 'solid',
      role: 'index',
    })).toThrow();
  });

  it('enforces max 10 series limit', () => {
    const tooMany: ChartConfigV3 = {
      version: 3,
      series: Array.from({ length: 11 }, (_, i) => ({
        id: `s${i}`,
        type: 'security' as const,
        securityId: 'sec',
        visible: true,
        lineStyle: 'solid' as const,
        axis: 'auto' as const,
      })),
    };
    expect(() => chartConfigV3Schema.parse(tooMany)).toThrow();
  });
});
