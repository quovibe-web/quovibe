// packages/api/src/services/chart-config.service.ts
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import { CURRENT_VERSION, upgradeChartConfig } from './chart-config-migrations';

// Scope-split: this schema permits ONLY portfolio-level content.
// Aesthetics (line thickness, smoothing) belong in sidecar preferences.chartStyle.
export const chartConfigContentSchema = z.object({
  seriesRefs: z.array(z.object({
    kind: z.enum(['account', 'security', 'taxonomy', 'benchmark']),
    id: z.string(),
  })).default([]),
  visibility: z.record(z.string(), z.boolean()).default({}),
  benchmarks: z.array(z.string()).default([]),
}).strict();                                           // refuse unknown keys

export type ChartConfigContent = z.infer<typeof chartConfigContentSchema>;

export interface ChartConfigRow {
  chartId: string;
  config: ChartConfigContent;
  schemaVersion: number;
  updatedAt: string;
}

function rowToItem(row: Record<string, unknown>): ChartConfigRow {
  const sv = row.schema_version as number;
  let parsed = JSON.parse(row.config_json as string);
  if (sv < CURRENT_VERSION) parsed = upgradeChartConfig(parsed, sv);
  // Forward compat: treat sv > CURRENT as empty content; UI renders unsupported marker.
  const content: ChartConfigContent = sv > CURRENT_VERSION
    ? { seriesRefs: [], visibility: {}, benchmarks: [] }
    : chartConfigContentSchema.parse(parsed);
  return {
    chartId: row.chart_id as string,
    config: content,
    schemaVersion: sv,
    updatedAt: row.updatedAt as string,
  };
}

export function getChartConfig(sqlite: BetterSqlite3.Database, chartId: string): ChartConfigRow | null {
  const row = sqlite.prepare('SELECT * FROM vf_chart_config WHERE chart_id = ?').get(chartId) as
    Record<string, unknown> | undefined;
  return row ? rowToItem(row) : null;
}

export function upsertChartConfig(
  sqlite: BetterSqlite3.Database,
  chartId: string,
  input: unknown,
): ChartConfigRow {
  const validated = chartConfigContentSchema.parse(input);    // rejects aesthetics keys
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO vf_chart_config (chart_id, config_json, schema_version, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chart_id) DO UPDATE SET
       config_json = excluded.config_json,
       schema_version = excluded.schema_version,
       updatedAt = excluded.updatedAt`,
  ).run(chartId, JSON.stringify(validated), CURRENT_VERSION, now);
  return getChartConfig(sqlite, chartId)!;
}
