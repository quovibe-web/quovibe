// packages/web/src/lib/__tests__/widget-registry-coverage.test.ts
// BUG-91 guardrail: every widget type that the API seeds (via the shared
// DEFAULT_DASHBOARD_WIDGETS constant) must exist in the web widget-registry,
// otherwise freshly-created portfolios render "Widget type 'X' not found".
import { describe, it, expect } from 'vitest';
import { DEFAULT_DASHBOARD_WIDGETS } from '@quovibe/shared';
import { getWidgetDef, WIDGET_REGISTRY } from '../widget-registry';

describe('widget registry coverage (BUG-91)', () => {
  it('every type in DEFAULT_DASHBOARD_WIDGETS resolves via getWidgetDef', () => {
    const missing: string[] = [];
    for (const w of DEFAULT_DASHBOARD_WIDGETS) {
      if (!getWidgetDef(w.type)) missing.push(w.type);
    }
    expect(missing).toEqual([]);
  });

  it('DEFAULT_DASHBOARD_WIDGETS is non-empty (prevents accidental wipe)', () => {
    expect(DEFAULT_DASHBOARD_WIDGETS.length).toBeGreaterThan(0);
  });

  it('dead widget types removed in BUG-91 are not in the registry', () => {
    for (const dead of ['performance-summary', 'performance-chart', 'asset-allocation-donut']) {
      expect(WIDGET_REGISTRY.find((w) => w.type === dead)).toBeUndefined();
    }
  });
});
