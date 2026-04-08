import { z } from 'zod';
import { CostMethod } from '../enums';
import { chartConfigV2Schema } from './benchmark.schema';

// ---------------------------------------------------------------------------
// Reporting period discriminated union
// ---------------------------------------------------------------------------

const lastYearsMonthsSchema = z.object({
  type: z.literal('lastYearsMonths'),
  years: z.number().int().min(0).max(99),
  months: z.number().int().min(0).max(11),
});

const lastDaysSchema = z.object({
  type: z.literal('lastDays'),
  days: z.number().int().min(1).max(9999),
});

const lastTradingDaysSchema = z.object({
  type: z.literal('lastTradingDays'),
  days: z.number().int().min(1).max(9999),
  calendarId: z.string().optional(),
});

const fromToSchema = z.object({
  type: z.literal('fromTo'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const sinceSchema = z.object({
  type: z.literal('since'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const yearSchema = z.object({
  type: z.literal('year'),
  year: z.number().int().min(1900).max(2100),
});

// Current period types — each expanded to z.literal for discriminatedUnion compatibility
const currentWeekSchema = z.object({ type: z.literal('currentWeek') });
const currentMonthSchema = z.object({ type: z.literal('currentMonth') });
const currentQuarterSchema = z.object({ type: z.literal('currentQuarter') });
const currentYTDSchema = z.object({ type: z.literal('currentYTD') });

// Previous period types — each expanded to z.literal for discriminatedUnion compatibility
const previousDaySchema = z.object({ type: z.literal('previousDay') });
const previousTradingDaySchema = z.object({ type: z.literal('previousTradingDay') });
const previousWeekSchema = z.object({ type: z.literal('previousWeek') });
const previousMonthSchema = z.object({ type: z.literal('previousMonth') });
const previousQuarterSchema = z.object({ type: z.literal('previousQuarter') });
const previousYearSchema = z.object({ type: z.literal('previousYear') });

export const reportingPeriodDefSchema = z.discriminatedUnion('type', [
  lastYearsMonthsSchema,
  lastDaysSchema,
  lastTradingDaysSchema,
  fromToSchema,
  sinceSchema,
  yearSchema,
  currentWeekSchema,
  currentMonthSchema,
  currentQuarterSchema,
  currentYTDSchema,
  previousDaySchema,
  previousTradingDaySchema,
  previousWeekSchema,
  previousMonthSchema,
  previousQuarterSchema,
  previousYearSchema,
]);

export type ReportingPeriodDef = z.infer<typeof reportingPeriodDefSchema>;

// ---------------------------------------------------------------------------
// Dashboard widget & dashboard schemas
// ---------------------------------------------------------------------------

export const dashboardWidgetSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().nullable().default(null),
  span: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const dashboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  widgets: z.array(dashboardWidgetSchema).default([]),
  metricsStripIds: z.array(z.string()).optional(),
  columns: z.union([
    z.literal('auto'), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]).default('auto'),
});

export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;

// ---------------------------------------------------------------------------
// Investments view schema
// ---------------------------------------------------------------------------

export const investmentsViewSchema = z.object({
  chartMode: z.enum(['pie', 'treemap', 'off']).default('pie'),
  showRetired: z.boolean().default(false),
  columns: z.union([
    z.array(z.string()),
    z.record(
      z.enum(['overview', 'performance', 'detail']),
      z.array(z.string())
    ),
  ]).default([]),
}).default({});

export type InvestmentsView = z.infer<typeof investmentsViewSchema>;

// ---------------------------------------------------------------------------
// Table layout schema
// ---------------------------------------------------------------------------

/** Valid table IDs: lowercase, starting with a letter, 3-31 chars, letters/digits/hyphens */
export const tableIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,30}$/);

const sortingEntrySchema = z.object({
  id: z.string(),
  desc: z.boolean(),
});

export const tableLayoutEntrySchema = z.object({
  columnOrder: z.array(z.string()).default([]),
  columnSizing: z.record(z.string(), z.number()).default({}),
  sorting: z.array(sortingEntrySchema).nullable().default(null),
  columnVisibility: z.record(z.string(), z.boolean()).nullable().default(null),
  version: z.number().int().default(1),
});

const tableLayoutsSchema = z.record(z.string(), tableLayoutEntrySchema).default({});

export type TableLayoutEntry = z.infer<typeof tableLayoutEntrySchema>;

// ---------------------------------------------------------------------------
// Main sidecar schema
// ---------------------------------------------------------------------------

const appSchema = z.object({
  lastImport: z.string().nullable().default(null),
  appVersion: z.string().nullable().default(null),
  initialized: z.boolean().default(false),
}).default({});

const preferencesSchema = z.object({
  language: z.string().default('en'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  sharesPrecision: z.number().int().min(1).max(8).default(1),
  quotesPrecision: z.number().int().min(1).max(8).default(2),
  showCurrencyCode: z.boolean().default(false),
  showPaSuffix: z.boolean().default(true),
  privacyMode: z.boolean().default(false),
  activeReportingPeriodId: z.string().optional(),
  defaultDataSeriesTaxonomyId: z.string().optional(),
}).default({});

export const quovibeSettingsSchema = z.object({
  version: z.number().int().default(1),
  app: appSchema,
  preferences: preferencesSchema,
  reportingPeriods: z.array(reportingPeriodDefSchema).default([]),
  dashboards: z.array(dashboardSchema).default([]),
  activeDashboard: z.string().nullable().default(null),
  investmentsView: investmentsViewSchema,
  chartConfig: chartConfigV2Schema.default({ version: 2, series: [] }),
  tableLayouts: tableLayoutsSchema,
});

export type QuovibeSettings = z.infer<typeof quovibeSettingsSchema>;
export type QuovibePreferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_SETTINGS: QuovibeSettings = quovibeSettingsSchema.parse({});

// ---------------------------------------------------------------------------
// API request schemas for settings updates
// ---------------------------------------------------------------------------

export const updateSettingsSchema = z.object({
  // DB fields (existing)
  costMethod: z.nativeEnum(CostMethod).optional(),
  currency: z.string().length(3).optional(),
  calendar: z.string().optional(),
  alphaVantageApiKey: z.string().optional(),
  alphaVantageRateLimit: z.string().optional(),
  // Sidecar fields
  language: z.string().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  sharesPrecision: z.number().int().min(1).max(8).optional(),
  quotesPrecision: z.number().int().min(1).max(8).optional(),
  showCurrencyCode: z.boolean().optional(),
  showPaSuffix: z.boolean().optional(),
  privacyMode: z.boolean().optional(),
  activeReportingPeriodId: z.string().optional(),
  defaultDataSeriesTaxonomyId: z.string().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const putDashboardSchema = z.object({
  dashboards: z.array(dashboardSchema),
  activeDashboard: z.string().nullable(),
});

export type PutDashboardInput = z.infer<typeof putDashboardSchema>;
