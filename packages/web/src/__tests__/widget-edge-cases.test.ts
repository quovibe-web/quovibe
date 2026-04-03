import { describe, test, expect } from 'vitest';
import { performanceKeys } from '../api/use-performance';
import { WIDGET_REGISTRY, getWidgetDef } from '../lib/widget-registry';
import { CostMethod } from '@quovibe/shared';

// ---------------------------------------------------------------------------
// F1: performanceKeys.calculation — distinct cache keys per data series
// ---------------------------------------------------------------------------

describe('F1: performanceKeys.calculation — distinct cache keys', () => {
  const start = '2024-01-01';
  const end = '2024-12-31';

  test('different filter values produce different keys', () => {
    const keyA = performanceKeys.calculation(start, end, false, CostMethod.FIFO, 'account-aaa');
    const keyB = performanceKeys.calculation(start, end, false, CostMethod.FIFO, 'account-bbb');
    expect(keyA).not.toEqual(keyB);
  });

  test('preTax true vs false produce different keys', () => {
    const keyTrue = performanceKeys.calculation(start, end, true, CostMethod.MOVING_AVERAGE);
    const keyFalse = performanceKeys.calculation(start, end, false, CostMethod.MOVING_AVERAGE);
    expect(keyTrue).not.toEqual(keyFalse);
  });

  test('different costMethod values produce different keys', () => {
    const keyFifo = performanceKeys.calculation(start, end, false, CostMethod.FIFO);
    const keyAvg = performanceKeys.calculation(start, end, false, CostMethod.MOVING_AVERAGE);
    expect(keyFifo).not.toEqual(keyAvg);
  });

  test('same params produce identical keys', () => {
    const keyA = performanceKeys.calculation(start, end, true, CostMethod.FIFO, 'acc-1');
    const keyB = performanceKeys.calculation(start, end, true, CostMethod.FIFO, 'acc-1');
    expect(keyA).toEqual(keyB);
  });

  test('taxonomyId and categoryId affect the key', () => {
    const base = performanceKeys.calculation(start, end, false, CostMethod.FIFO, undefined, false);
    const withTax = performanceKeys.calculation(start, end, false, CostMethod.FIFO, undefined, false, 'tax-1');
    const withCat = performanceKeys.calculation(start, end, false, CostMethod.FIFO, undefined, false, 'tax-1', 'cat-1');
    expect(base).not.toEqual(withTax);
    expect(withTax).not.toEqual(withCat);
  });
});

// ---------------------------------------------------------------------------
// F5: Default dashboard config idempotency
// (uniqueness test already in widget-registry.test.ts — not duplicated here)
// ---------------------------------------------------------------------------

describe('F5: default dashboard idempotency', () => {
  test('WIDGET_REGISTRY.map produces same widget list each call', () => {
    const build = () =>
      WIDGET_REGISTRY.map((w) => ({
        id: `default-${w.type}`,
        type: w.type,
        title: null,
        span: w.defaultSpan,
        config: { ...w.defaultConfig },
      }));
    const first = build();
    const second = build();
    expect(first).toEqual(second);
    expect(first.length).toBe(WIDGET_REGISTRY.length);
  });

  test('defaultConfig objects are independent copies between calls', () => {
    const build = () =>
      WIDGET_REGISTRY.map((w) => ({
        type: w.type,
        config: { ...w.defaultConfig },
      }));
    const first = build();
    const second = build();
    // Mutating one copy must not affect the other
    for (const item of first) {
      (item.config as Record<string, unknown>)['__mutated'] = true;
    }
    for (const item of second) {
      expect((item.config as Record<string, unknown>)['__mutated']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// F6: Unknown widget type handling
// ---------------------------------------------------------------------------

describe('F6: unknown widget type handling', () => {
  test('getWidgetDef returns undefined for unknown type', () => {
    expect(getWidgetDef('totally-unknown-type')).toBeUndefined();
  });

  test('getWidgetDef returns undefined for empty string', () => {
    expect(getWidgetDef('')).toBeUndefined();
  });

  test('getWidgetDef returns a valid def for every registered type', () => {
    for (const w of WIDGET_REGISTRY) {
      const def = getWidgetDef(w.type);
      expect(def).toBeDefined();
      expect(def!.type).toBe(w.type);
    }
  });
});
