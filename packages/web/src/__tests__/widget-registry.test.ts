import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { WIDGET_REGISTRY } from '../lib/widget-registry';

describe('WIDGET_REGISTRY', () => {
  it('has 26 registered widget types', () => {
    expect(WIDGET_REGISTRY).toHaveLength(26);
  });

  it('every type is unique', () => {
    const types = WIDGET_REGISTRY.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('every category is valid', () => {
    const validCategories = new Set(['performance', 'chart', 'risk', 'info']);
    for (const w of WIDGET_REGISTRY) {
      expect(validCategories.has(w.category)).toBe(true);
    }
  });

  it('every defaultSpan is 1, 2, or 3', () => {
    for (const w of WIDGET_REGISTRY) {
      expect([1, 2, 3]).toContain(w.defaultSpan);
    }
  });

  it('every entry has a component', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.component).toBeDefined();
    }
  });

  it('every entry has a non-empty i18nKey', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.i18nKey).toBeTruthy();
      expect(typeof w.i18nKey).toBe('string');
      expect(w.i18nKey.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty descriptionKey', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.descriptionKey).toBeTruthy();
      expect(typeof w.descriptionKey).toBe('string');
      expect(w.descriptionKey.length).toBeGreaterThan(0);
    }
  });

  it('every entry has qualifierKey as string or null', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.qualifierKey === null || typeof w.qualifierKey === 'string').toBe(true);
    }
  });

  it('KPI widgets have non-null qualifierKey', () => {
    const kpiTypes = ['market-value', 'ttwror', 'ttwror-pa', 'irr', 'delta', 'absolute-performance', 'absolute-change'];
    for (const type of kpiTypes) {
      const def = WIDGET_REGISTRY.find((w) => w.type === type);
      expect(def).toBeDefined();
      expect(def!.qualifierKey).toBeTruthy();
    }
  });

  it('non-KPI widgets have null qualifierKey', () => {
    const nonKpiTypes = ['calculation-compact', 'perf-chart', 'drawdown-chart'];
    for (const type of nonKpiTypes) {
      const def = WIDGET_REGISTRY.find((w) => w.type === type);
      expect(def).toBeDefined();
      expect(def!.qualifierKey).toBeNull();
    }
  });

  it('adding a widget produces a valid instance with unique id', () => {
    const existingIds = WIDGET_REGISTRY.map((w) => `default-${w.type}`);
    const def = WIDGET_REGISTRY[0];
    const newWidget = {
      id: nanoid(),
      type: def.type,
      title: null,
      span: def.defaultSpan,
      config: structuredClone(def.defaultConfig),
    };
    // Unique id
    expect(existingIds).not.toContain(newWidget.id);
    // Correct shape
    expect(newWidget).toHaveProperty('id');
    expect(newWidget).toHaveProperty('type', def.type);
    expect(newWidget).toHaveProperty('title', null);
    expect(newWidget).toHaveProperty('span', def.defaultSpan);
    expect(newWidget).toHaveProperty('config');
    expect(typeof newWidget.id).toBe('string');
    expect(newWidget.id.length).toBeGreaterThan(0);
  });
});
