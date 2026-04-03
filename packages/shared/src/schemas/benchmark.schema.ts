import { z } from 'zod';

// --- V1: Legacy Benchmark Config (preserved for migration parsing) ---

export const benchmarkConfigSchema = z.object({
  securityId: z.string(),
  color: z.string().optional(),
});

export type BenchmarkConfig = z.infer<typeof benchmarkConfigSchema>;

export const chartConfigSchema = z.object({
  benchmarks: z.array(benchmarkConfigSchema).max(5).default([]),
}).default({});

export type ChartConfigV1 = z.infer<typeof chartConfigSchema>;

// --- V2: Unified Data Series Config ---

export const dataSeriesTypeEnum = z.enum([
  'portfolio',
  'security',
  'account',
  'benchmark',
  'periodic_bars',
]);

export type DataSeriesType = z.infer<typeof dataSeriesTypeEnum>;

export const lineStyleEnum = z.enum(['solid', 'dashed', 'dotted']);

export type LineStyle = z.infer<typeof lineStyleEnum>;

export const barIntervalEnum = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
export type BarInterval = z.infer<typeof barIntervalEnum>;

export const dataSeriesConfigSchema = z.object({
  id: z.string().min(1),
  type: dataSeriesTypeEnum,
  securityId: z.string().optional(),
  accountId: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  visible: z.boolean(),
  lineStyle: lineStyleEnum,
  label: z.string().nullable().optional(),
  barInterval: barIntervalEnum.optional(),
  positiveColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  negativeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  areaFill: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
}).superRefine((val, ctx) => {
  if ((val.type === 'security' || val.type === 'benchmark') && !val.securityId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'securityId is required for security and benchmark series',
      path: ['securityId'],
    });
  }
  if (val.type === 'account' && !val.accountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'accountId is required for account series',
      path: ['accountId'],
    });
  }
  if (val.type === 'periodic_bars' && !val.barInterval) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'barInterval is required for periodic_bars series',
      path: ['barInterval'],
    });
  }
});

export type DataSeriesConfig = z.infer<typeof dataSeriesConfigSchema>;

export const chartConfigV2Schema = z.object({
  version: z.literal(2),
  series: z.array(dataSeriesConfigSchema).max(10).default([]),
}).superRefine((val, ctx) => {
  const barCount = val.series.filter((s) => s.type === 'periodic_bars').length;
  if (barCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At most one periodic_bars series is allowed',
      path: ['series'],
    });
  }
});

export type ChartConfigV2 = z.infer<typeof chartConfigV2Schema>;

/**
 * Generate a short random ID for series config entries.
 * @returns An 8-character alphanumeric string.
 */
export function generateSeriesId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) { // native-ok
    id += chars[Math.floor(Math.random() * chars.length)]; // native-ok
  }
  return id;
}

/** Default chart config when none exists. */
export const DEFAULT_CHART_CONFIG: ChartConfigV2 = {
  version: 2,
  series: [{
    id: 'portfolio-default',
    type: 'portfolio',
    visible: true,
    lineStyle: 'solid',
  }],
};

/**
 * Migrate v1 ChartConfig to v2. Preserves existing benchmarks as benchmark series.
 * Prepends a default portfolio series.
 * @param v1 - The v1 config object (may have a `benchmarks` array).
 * @returns A valid ChartConfigV2 object.
 */
export function migrateChartConfigV1toV2(
  v1: { benchmarks?: Array<{ securityId: string; color?: string }> },
): ChartConfigV2 {
  const series: DataSeriesConfig[] = [
    {
      id: 'portfolio-default',
      type: 'portfolio',
      visible: true,
      lineStyle: 'solid',
    },
  ];
  for (const bm of v1.benchmarks ?? []) {
    series.push({
      id: generateSeriesId(),
      type: 'benchmark',
      securityId: bm.securityId,
      color: bm.color ?? null,
      visible: true,
      lineStyle: 'dashed',
    });
  }
  return { version: 2, series };
}

/** Unified ChartConfig — always v2 at runtime after migration. */
export type ChartConfig = ChartConfigV2;
