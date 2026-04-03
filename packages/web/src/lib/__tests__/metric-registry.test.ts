import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY, DEFAULT_METRIC_IDS } from '../metric-registry';

describe('METRIC_REGISTRY', () => {
  it('contiene una entry per ttwrorPa', () => {
    const entry = METRIC_REGISTRY.find((m) => m.id === 'ttwrorPa');
    expect(entry).toBeDefined();
  });

  it('ttwrorPa ha format percentage e colorize true', () => {
    const entry = METRIC_REGISTRY.find((m) => m.id === 'ttwrorPa');
    expect(entry?.format).toBe('percentage');
    expect(entry?.colorize).toBe(true);
  });

  it('ttwrorPa.getValue legge calc.ttwrorPa come float', () => {
    const entry = METRIC_REGISTRY.find((m) => m.id === 'ttwrorPa')!;
    type GetValueParam = Parameters<typeof entry.getValue>[0];
    const fakeCalc = { ttwrorPa: '0.1402' } as GetValueParam;
    expect(entry.getValue(fakeCalc).primary).toBeCloseTo(0.1402);
  });

  it('ttwror è ancora presente nel registry (disponibile in Personalizza)', () => {
    const entry = METRIC_REGISTRY.find((m) => m.id === 'ttwror');
    expect(entry).toBeDefined();
  });
});

describe('DEFAULT_METRIC_IDS', () => {
  it('contiene ttwrorPa', () => {
    expect(DEFAULT_METRIC_IDS).toContain('ttwrorPa');
  });

  it('non contiene ttwror nei default', () => {
    expect(DEFAULT_METRIC_IDS).not.toContain('ttwror');
  });

  it('ha esattamente 5 elementi', () => {
    expect(DEFAULT_METRIC_IDS).toHaveLength(5);
  });

  it('mantiene mv, irr, delta, absPerf nei default', () => {
    expect(DEFAULT_METRIC_IDS).toContain('mv');
    expect(DEFAULT_METRIC_IDS).toContain('irr');
    expect(DEFAULT_METRIC_IDS).toContain('delta');
    expect(DEFAULT_METRIC_IDS).toContain('absPerf');
  });
});
