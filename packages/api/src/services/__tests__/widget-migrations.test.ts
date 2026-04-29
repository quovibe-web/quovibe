// packages/api/src/services/__tests__/widget-migrations.test.ts
import { describe, it, expect } from 'vitest';
import { MIGRATIONS, CURRENT_VERSION, upgradeWidgets } from '../widget-migrations';

describe('widget-migrations', () => {
  it('CURRENT_VERSION equals MIGRATIONS.length + 1 (pin for PRs that bump schema_version)', () => {
    expect(CURRENT_VERSION).toBe(MIGRATIONS.length + 1);
  });
  it('upgradeWidgets(v=CURRENT) is identity', () => {
    const j = [{ id: 'w1', type: 't' }];
    expect(upgradeWidgets(j, CURRENT_VERSION)).toBe(j);
  });
  it('throws when a gap exists in migration chain', () => {
    // With CURRENT_VERSION≥2 we cannot hit a gap at v=0 reliably without
    // depending on schema progression. The gap-detection lives inside the
    // while-loop; jumping ahead (from > CURRENT) never enters it, so exercise
    // the throw path with a deliberate sentinel.
    const bogus = (CURRENT_VERSION - 1) - 100;   // native-ok: test-only arithmetic
    expect(() => upgradeWidgets({}, bogus)).toThrow();
  });
});

describe('widget-migrations v1→v2 (BUG-91: legacy widget types)', () => {
  it('renames performance-chart → perf-chart, preserving id/span/config', () => {
    const legacy = [
      { id: 'w-chart', type: 'performance-chart', title: null, span: 3, config: { foo: 1 } },
    ];
    const migrated = upgradeWidgets(legacy, 1) as Array<{ id: string; type: string; span: number; config: { foo: number } }>;
    expect(migrated).toHaveLength(1);
    expect(migrated[0].id).toBe('w-chart');
    expect(migrated[0].type).toBe('perf-chart');
    expect(migrated[0].span).toBe(3);
    expect(migrated[0].config).toEqual({ foo: 1 });
  });

  it('renames performance-summary → market-value, preserving id/span/config', () => {
    const legacy = [
      { id: 'w-summary', type: 'performance-summary', title: null, span: 3, config: {} },
    ];
    const migrated = upgradeWidgets(legacy, 1) as Array<{ id: string; type: string; span: number }>;
    expect(migrated).toHaveLength(1);
    expect(migrated[0].id).toBe('w-summary');
    expect(migrated[0].type).toBe('market-value');
    expect(migrated[0].span).toBe(3);
  });

  it('drops asset-allocation-donut (no registry replacement available)', () => {
    const legacy = [
      { id: 'w-alloc', type: 'asset-allocation-donut', title: null, span: 1, config: {} },
      { id: 'w-top',   type: 'top-holdings',           title: null, span: 2, config: {} },
    ];
    const migrated = upgradeWidgets(legacy, 1) as Array<{ id: string; type: string }>;
    expect(migrated).toHaveLength(1);
    expect(migrated[0].id).toBe('w-top');
    expect(migrated[0].type).toBe('top-holdings');
  });

  it('full legacy DEFAULT_WIDGETS seed becomes a valid 3-widget dashboard', () => {
    const legacy = [
      { id: 'w-summary', type: 'performance-summary',    title: null, span: 3, config: {} },
      { id: 'w-chart',   type: 'performance-chart',      title: null, span: 3, config: {} },
      { id: 'w-alloc',   type: 'asset-allocation-donut', title: null, span: 1, config: {} },
      { id: 'w-top',     type: 'top-holdings',           title: null, span: 2, config: {} },
    ];
    const migrated = upgradeWidgets(legacy, 1) as Array<{ id: string; type: string }>;
    expect(migrated.map(w => w.type)).toEqual(['market-value', 'perf-chart', 'top-holdings']);
  });

  it('leaves unrelated widget types unchanged', () => {
    const current = [
      { id: 'a', type: 'irr',          title: null, span: 1, config: {} },
      { id: 'b', type: 'perf-chart',   title: null, span: 3, config: {} },
      { id: 'c', type: 'market-value', title: null, span: 1, config: {} },
    ];
    const migrated = upgradeWidgets(current, 1) as Array<{ type: string }>;
    expect(migrated.map(w => w.type)).toEqual(['irr', 'perf-chart', 'market-value']);
  });

  it('returns empty array when widgets_json is not an array (defensive)', () => {
    // Older rows should always be arrays, but guard against malformed JSON so
    // the migration never throws TypeError on .filter/.map.
    expect(upgradeWidgets({ not: 'an array' }, 1)).toEqual([]);
    expect(upgradeWidgets(null, 1)).toEqual([]);
  });
});
