import { describe, it, expect } from 'vitest';
import {
  dashboardWidgetSchema,
  dashboardSchema,
} from '../schemas/settings.schema';

describe('dashboardWidgetSchema', () => {
  it('parses a valid widget', () => {
    const result = dashboardWidgetSchema.parse({
      id: 'w1',
      type: 'ttwror',
    });
    expect(result.id).toBe('w1');
    expect(result.type).toBe('ttwror');
    expect(result.title).toBeNull();
    expect(result.span).toBe(1);
    expect(result.config).toEqual({});
  });

  it('parses widget with all fields', () => {
    const result = dashboardWidgetSchema.parse({
      id: 'w2',
      type: 'perf-chart',
      title: 'My Chart',
      span: 3,
      config: { color: 'blue' },
    });
    expect(result.title).toBe('My Chart');
    expect(result.span).toBe(3);
    expect(result.config).toEqual({ color: 'blue' });
  });

  it('rejects missing id', () => {
    expect(() => dashboardWidgetSchema.parse({ type: 'ttwror' })).toThrow();
  });

  it('rejects missing type', () => {
    expect(() => dashboardWidgetSchema.parse({ id: 'w1' })).toThrow();
  });

  it('rejects invalid span (4)', () => {
    expect(() =>
      dashboardWidgetSchema.parse({ id: 'w1', type: 'ttwror', span: 4 })
    ).toThrow();
  });

  it('rejects invalid span (0)', () => {
    expect(() =>
      dashboardWidgetSchema.parse({ id: 'w1', type: 'ttwror', span: 0 })
    ).toThrow();
  });
});

describe('dashboardSchema', () => {
  it('parses a valid dashboard', () => {
    const result = dashboardSchema.parse({
      id: 'd1',
      name: 'Default',
    });
    expect(result.widgets).toEqual([]);
  });

  it('parses dashboard with widgets', () => {
    const result = dashboardSchema.parse({
      id: 'd1',
      name: 'Main',
      widgets: [{ id: 'w1', type: 'irr' }],
    });
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].span).toBe(1);
  });
});

