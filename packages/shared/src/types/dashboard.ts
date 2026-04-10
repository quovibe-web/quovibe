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

export type WidgetCategory = 'performance' | 'reports' | 'chart' | 'risk' | 'info';

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
