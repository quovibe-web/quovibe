import type { ReportingPeriodDef } from '../schemas/settings.schema';

/**
 * Discriminated union for widget data source selection.
 * PROVISIONAL — defined now to establish the contract shape.
 * Real consumption comes in a future prompt when widgets fetch data.
 */
export type DataSeriesValue =
  | { type: 'portfolio'; preTax: false }
  | { type: 'account'; accountId: string; withReference: boolean }
  | { type: 'taxonomy'; taxonomyId: string; categoryId?: string }
  | { type: 'security'; securityId: string };

export type WidgetCategory = 'performance' | 'chart' | 'risk' | 'info';

/** Per-widget period override. Stores a semantic definition + resolved dates. */
export interface ReportingPeriodOverride {
  definition: ReportingPeriodDef;
  periodStart: string;
  periodEnd: string;
}

/**
 * Base definition for a widget registry entry.
 * The `component` field is frontend-only and lives in the web package's WidgetDef.
 */
export interface WidgetDefBase {
  type: string;
  i18nKey: string;
  descriptionKey: string;
  /** i18n key for the qualifier shown on LINE 4 of KPI widgets (e.g. "cumulative", "annualized"). Null for non-KPI widgets. */
  qualifierKey: string | null;
  category: WidgetCategory;
  zone: 'chart' | 'detail';
  defaultSpan: 1 | 2 | 3;
  /**
   * Default configuration values for this widget type.
   * Intentionally `Record<string, unknown>`: each widget type defines its own
   * config shape. The web package's WidgetDef extends this with a typed `config` field.
   */
  defaultConfig: Record<string, unknown>;
  capabilities: {
    hasDataSeries: boolean;
    hasPeriodOverride: boolean;
    hasCustomOptions: boolean;
  };
}

/**
 * Shape of a single seeded widget in a freshly-created dashboard.
 * Mirrors the persisted `widgets_json` object layout; kept loose (config is
 * Record<string, unknown>) because each widget type owns its own config schema.
 */
export interface DefaultDashboardWidget {
  id: string;
  type: string;
  title: string | null;
  span: 1 | 2 | 3;
  config: Record<string, unknown>;
}

/**
 * Default "Overview" dashboard layout seeded for every non-demo portfolio
 * (source='fresh' and source='import-pp-xml'). Widget `type` strings MUST
 * exist in the web widget-registry — BUG-91 traces to this list having
 * drifted. A coverage test in `packages/web` pins the invariant.
 *
 * Layout (3-column grid):
 *   row 1 — market-value | ttwror | irr                   (three 1-span KPIs)
 *   row 2 — perf-chart   (full width)
 *   row 3 — top-holdings (2) | absolute-performance (1)
 */
export const DEFAULT_DASHBOARD_WIDGETS: readonly DefaultDashboardWidget[] = [
  { id: 'w-mv',       type: 'market-value',         title: null, span: 1, config: {} },
  { id: 'w-ttwror',   type: 'ttwror',               title: null, span: 1, config: {} },
  { id: 'w-irr',      type: 'irr',                  title: null, span: 1, config: {} },
  { id: 'w-chart',    type: 'perf-chart',           title: null, span: 3, config: {} },
  { id: 'w-top',      type: 'top-holdings',         title: null, span: 2, config: {} },
  { id: 'w-absperf',  type: 'absolute-performance', title: null, span: 1, config: {} },
];
