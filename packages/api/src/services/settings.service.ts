/**
 * Sidecar Settings Service
 *
 * CLASSIFICATION BOUNDARY:
 * - DB (property table): legacy data — costMethod, currency, calendar, baseCurrency, provider.* keys
 * - Sidecar (this file): quovibe-only state — app lifecycle, user preferences, reporting periods
 *
 * Rule: NEVER write a new quovibe-only key to the property table or config_entry.
 * Rule: NEVER read the property table for application state.
 */

import fs from 'fs';
import path from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import { DB_PATH } from '../config';
import {
  quovibeSettingsSchema,
  DEFAULT_SETTINGS,
  type QuovibeSettings,
  type QuovibePreferences,
  migrateChartConfigV1toV2,
  DEFAULT_CHART_CONFIG,
} from '@quovibe/shared';

const SIDECAR_FILENAME = 'quovibe.settings.json';
const sidecarPath = path.join(path.dirname(DB_PATH), SIDECAR_FILENAME);

let cached: QuovibeSettings = { ...DEFAULT_SETTINGS };

/**
 * Load settings from the sidecar file into memory.
 * Called at startup and after a DB reload.
 * Does NOT create the file if it does not exist.
 * Falls back to DEFAULT_SETTINGS on any error.
 */
export function loadSettings(): void {
  if (!fs.existsSync(sidecarPath)) {
    cached = { ...DEFAULT_SETTINGS };
    return;
  }
  try {
    const raw = fs.readFileSync(sidecarPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Migrate chartConfig v1 → v2 if needed
    if (parsed.chartConfig && !parsed.chartConfig.version) {
      parsed.chartConfig = migrateChartConfigV1toV2(parsed.chartConfig);
    }
    // Ensure default config if missing
    if (!parsed.chartConfig) {
      parsed.chartConfig = DEFAULT_CHART_CONFIG;
    }
    cached = quovibeSettingsSchema.parse(parsed);
  } catch (err) {
    console.warn(`[quovibe] Failed to parse sidecar ${sidecarPath}, using defaults:`, err);
    cached = { ...DEFAULT_SETTINGS };
  }
}

/**
 * Return the currently cached settings (sync, no I/O).
 */
export function getSettings(): QuovibeSettings {
  return cached;
}

/**
 * Deep-merge partial updates, validate with Zod, write atomically (.tmp → rename),
 * update the in-memory cache, and return the new validated settings.
 */
export function updateSettings(partial: {
  app?: Partial<QuovibeSettings['app']>;
  preferences?: Partial<QuovibePreferences>;
  reportingPeriods?: QuovibeSettings['reportingPeriods'];
  dashboards?: QuovibeSettings['dashboards'];
  activeDashboard?: string | null;
  investmentsView?: Partial<QuovibeSettings['investmentsView']>;
  allocationView?: Partial<QuovibeSettings['allocationView']>;
  chartConfig?: Partial<QuovibeSettings['chartConfig']>;
  tableLayouts?: QuovibeSettings['tableLayouts'];
}): QuovibeSettings {
  const merged = {
    ...cached,
    app: { ...cached.app, ...partial.app },
    preferences: { ...cached.preferences, ...partial.preferences },
    reportingPeriods: partial.reportingPeriods ?? cached.reportingPeriods,
    dashboards: partial.dashboards ?? cached.dashboards,
    activeDashboard: partial.activeDashboard !== undefined
      ? partial.activeDashboard
      : cached.activeDashboard,
    investmentsView: { ...cached.investmentsView, ...partial.investmentsView,
      columns: partial.investmentsView?.columns ?? cached.investmentsView?.columns ?? [],
    },
    allocationView: { ...cached.allocationView, ...partial.allocationView },
    chartConfig: partial.chartConfig
      ? { version: 2 as const, series: partial.chartConfig.series ?? cached.chartConfig?.series ?? [] }
      : cached.chartConfig ?? { version: 2, series: [] },
    tableLayouts: partial.tableLayouts ?? cached.tableLayouts,
  };
  const validated = quovibeSettingsSchema.parse(merged);

  // Atomic write: write to .tmp then rename (atomic on Linux/Docker)
  const tmpPath = sidecarPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2), 'utf-8');
  fs.renameSync(tmpPath, sidecarPath);

  cached = validated;
  return validated;
}

/**
 * Convenience wrapper: update only the `app` section.
 */
export function updateAppState(partial: Partial<QuovibeSettings['app']>): QuovibeSettings {
  return updateSettings({ app: partial });
}

/**
 * Convenience wrapper: update only the `preferences` section.
 */
export function updatePreferences(partial: Partial<QuovibePreferences>): QuovibeSettings {
  return updateSettings({ preferences: partial });
}

/**
 * One-time migration: move portfolio.lastImport from the property table to the sidecar.
 * Must be called AFTER loadSettings() and with a valid DB handle.
 * Idempotent: if the property row doesn't exist, this is a no-op.
 */
export function migrateLastImportFromDb(sqlite: BetterSqlite3.Database): void {
  try {
    const row = sqlite
      .prepare('SELECT value FROM property WHERE name = ?')
      .get('portfolio.lastImport') as { value: string } | undefined;

    if (row && cached.app.lastImport === null) {
      updateAppState({ lastImport: row.value });
    }

    // Delete from property table regardless (cleanup even if sidecar already has a value)
    sqlite.prepare('DELETE FROM property WHERE name = ?').run('portfolio.lastImport');
  } catch (err) {
    console.warn('[quovibe] lastImport migration from property table failed:', err);
  }
}
