import { z } from 'zod';
import { Router, type RequestHandler, type Router as RouterType } from 'express';
import { reportingPeriodDefSchema, resolveReportingPeriod, investmentsViewSchema, allocationViewSchema, chartConfigV2Schema, tableIdSchema, tableLayoutEntrySchema, preferencesSchema } from '@quovibe/shared';
import { getSettings, updateSettings } from '../services/settings.service';

export const settingsRouter: RouterType = Router();

// GET /api/settings — full sidecar payload for the user-level settings page.
// Read-only; Zod validation not needed.
settingsRouter.get('/', (_req, res) => {
  const s = getSettings();
  res.json({ preferences: s.preferences, app: s.app });
});

// PUT /api/settings/preferences — partial merge into the sidecar's preferences section.
const putPreferencesSchema = preferencesSchema.removeDefault().partial();
settingsRouter.put('/preferences', (req, res) => {
  const parsed = putPreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PREFERENCES', details: parsed.error.format() });
    return;
  }
  const updated = updateSettings({ preferences: parsed.data });
  res.json(updated.preferences);
});

/** GET /api/settings/reporting-periods */
const getReportingPeriods: RequestHandler = (_req, res) => {
  const { reportingPeriods } = getSettings();

  // Per ADR-015 the settings router is not portfolio-scoped. Calendar lookup
  // falls back to 'default'; period definitions may override via period.calendarId.
  const globalCalendar = 'default';

  const today = new Date().toISOString().slice(0, 10);
  const resolved = reportingPeriods.map((period) => {
    const calendarId = ('calendarId' in period && period.calendarId) ? period.calendarId : globalCalendar;
    return {
      definition: period,
      resolved: resolveReportingPeriod(period, today, calendarId),
    };
  });

  res.json({ periods: resolved });
};

/** POST /api/settings/reporting-periods */
const addReportingPeriod: RequestHandler = (req, res) => {
  const result = reportingPeriodDefSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'INVALID_PERIOD', details: result.error.format() });
    return;
  }

  const settings = getSettings();
  const updated = updateSettings({
    reportingPeriods: [...settings.reportingPeriods, result.data],
  });

  res.status(201).json({ periods: updated.reportingPeriods });
};

/** PUT /api/settings/reporting-periods — replace entire array (reorder) */
const replaceReportingPeriods: RequestHandler = (req, res) => {
  const periods = req.body;
  if (!Array.isArray(periods)) {
    res.status(400).json({ error: 'INVALID_PERIOD', details: 'Expected an array' });
    return;
  }

  for (let i = 0; i < periods.length; i++) {
    const result = reportingPeriodDefSchema.safeParse(periods[i]);
    if (!result.success) {
      res.status(400).json({ error: 'INVALID_PERIOD', details: { index: i, ...result.error.format() } });
      return;
    }
  }

  const updated = updateSettings({ reportingPeriods: periods });
  res.json({ periods: updated.reportingPeriods });
};

/** DELETE /api/settings/reporting-periods/:index */
const deleteReportingPeriod: RequestHandler = (req, res) => {
  const rawIndex = req.params.index;
  const index = parseInt(Array.isArray(rawIndex) ? rawIndex[0] : rawIndex, 10);
  const { reportingPeriods } = getSettings();

  if (isNaN(index) || index < 0 || index >= reportingPeriods.length) {
    res.status(404).json({ error: 'PERIOD_NOT_FOUND' });
    return;
  }

  const updated = [...reportingPeriods];
  updated.splice(index, 1);
  const result = updateSettings({ reportingPeriods: updated });

  res.json({ periods: result.reportingPeriods });
};

settingsRouter.get('/reporting-periods', getReportingPeriods);
settingsRouter.post('/reporting-periods', addReportingPeriod);
settingsRouter.put('/reporting-periods', replaceReportingPeriods);
settingsRouter.delete('/reporting-periods/:index', deleteReportingPeriod);

// GET /api/settings/investments-view
settingsRouter.get('/investments-view', (_req, res) => {
  const { investmentsView } = getSettings();
  res.json(investmentsView ?? { chartMode: 'pie', showRetired: false, columns: {} });
});

// PUT /api/settings/investments-view
settingsRouter.put('/investments-view', (req, res) => {
  const body = investmentsViewSchema.removeDefault().partial().parse(req.body);
  const updated = updateSettings({ investmentsView: body });
  res.json(updated.investmentsView);
});

// GET /api/settings/allocation-view
settingsRouter.get('/allocation-view', (_req, res) => {
  const { allocationView } = getSettings();
  res.json(allocationView ?? { chartMode: 'pie' });
});

// PUT /api/settings/allocation-view
settingsRouter.put('/allocation-view', (req, res) => {
  const parsed = allocationViewSchema.removeDefault().partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_ALLOCATION_VIEW', details: parsed.error.format() });
    return;
  }
  const updated = updateSettings({ allocationView: parsed.data });
  res.json(updated.allocationView);
});

// GET /api/settings/chart-config
settingsRouter.get('/chart-config', (_req, res) => {
  const { chartConfig } = getSettings();
  res.json(chartConfig ?? { version: 2, series: [] });
});

// PUT /api/settings/chart-config
// Note: .partial() intentionally omitted — PUT replaces the entire chartConfig.
settingsRouter.put('/chart-config', (req, res) => {
  const parsed = chartConfigV2Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_CHART_CONFIG', details: parsed.error.format() });
    return;
  }
  const updated = updateSettings({ chartConfig: parsed.data });
  res.json(updated.chartConfig);
});

// ---------------------------------------------------------------------------
// Table layout routes (unified persistence for sort, sizing, order, visibility)
// ---------------------------------------------------------------------------

function validateTableId(tableId: string): boolean {
  return tableIdSchema.safeParse(tableId).success;
}

const TABLE_LAYOUT_DEFAULTS: TableLayoutDefaults = {
  columnOrder: [],
  columnSizing: {},
  sorting: null,
  columnVisibility: null,
  version: 1,
};

type TableLayoutDefaults = {
  columnOrder: string[];
  columnSizing: Record<string, number>;
  sorting: { id: string; desc: boolean }[] | null;
  columnVisibility: Record<string, boolean> | null;
  version: number;
};

// GET /api/settings/table-layouts/:tableId
settingsRouter.get('/table-layouts/:tableId', (req, res) => {
  const tableId = req.params.tableId as string;
  if (!validateTableId(tableId)) {
    res.status(400).json({ error: 'INVALID_TABLE_ID' });
    return;
  }
  const { tableLayouts } = getSettings();
  const entry = tableLayouts?.[tableId] ?? { ...TABLE_LAYOUT_DEFAULTS };
  res.json(entry);
});

// PUT /api/settings/table-layouts/:tableId
// Accepts partial updates — only fields present in the body are merged.
settingsRouter.put('/table-layouts/:tableId', (req, res) => {
  const tableId = req.params.tableId as string;
  if (!validateTableId(tableId)) {
    res.status(400).json({ error: 'INVALID_TABLE_ID' });
    return;
  }

  // Use partial schema for PUT to distinguish "not sent" from "sent as default"
  const partialSchema = tableLayoutEntrySchema.partial();
  const parsed = partialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_TABLE_LAYOUT', details: parsed.error.format() });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const current = getSettings();
  const existing = current.tableLayouts?.[tableId] ?? { ...TABLE_LAYOUT_DEFAULTS };

  const merged = {
    ...current.tableLayouts,
    [tableId]: {
      columnOrder: 'columnOrder' in body ? (parsed.data.columnOrder ?? []) : existing.columnOrder,
      columnSizing: 'columnSizing' in body
        ? { ...existing.columnSizing, ...parsed.data.columnSizing }
        : existing.columnSizing,
      sorting: 'sorting' in body ? (parsed.data.sorting ?? null) : existing.sorting,
      columnVisibility: 'columnVisibility' in body ? (parsed.data.columnVisibility ?? null) : existing.columnVisibility,
      version: 'version' in body ? (parsed.data.version ?? 1) : existing.version,
    },
  };

  const updated = updateSettings({ tableLayouts: merged });
  res.json(updated.tableLayouts![tableId]);
});

// DELETE /api/settings/table-layouts/:tableId
settingsRouter.delete('/table-layouts/:tableId', (req, res) => {
  const tableId = req.params.tableId as string;
  if (!validateTableId(tableId)) {
    res.status(400).json({ error: 'INVALID_TABLE_ID' });
    return;
  }

  const current = getSettings();
  const { [tableId]: _, ...rest } = current.tableLayouts ?? {};

  updateSettings({ tableLayouts: rest });
  res.json({ ok: true });
});

// PUT /api/settings/auto-fetch{,-fx} — toggle a single boolean app flag.
// Body shape: { [key]: boolean }; response echoes the same shape.
function makeAppFlagPut<K extends 'autoFetchPricesOnFirstOpen' | 'autoFetchFxOnFirstOpen'>(
  key: K,
): RequestHandler {
  const schema = z.object({ [key]: z.boolean() } as Record<K, z.ZodBoolean>);
  return (req, res) => {
    const p = schema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
    const current = getSettings();
    const updated = updateSettings({
      app: { ...current.app, [key]: (p.data as Record<K, boolean>)[key] },
    });
    res.json({ [key]: updated.app[key] });
  };
}

settingsRouter.put('/auto-fetch', makeAppFlagPut('autoFetchPricesOnFirstOpen'));
settingsRouter.put('/auto-fetch-fx', makeAppFlagPut('autoFetchFxOnFirstOpen'));
