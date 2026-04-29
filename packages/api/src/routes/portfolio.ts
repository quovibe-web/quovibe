import { Router, type Router as RouterType } from 'express';
import type { RequestHandler } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { updateSettingsSchema } from '@quovibe/shared';
import { configEntries } from '../db/schema';
import { getDb, getSqlite } from '../helpers/request';
import { getSettings, updateAppState } from '../services/settings.service';

// quovibe stores its own settings in the `property` table (same key space as baseCurrency).
// Keys are prefixed with 'portfolio.' to namespace from legacy properties.
const QUOVIBE_SETTING_KEYS = ['portfolio.costMethod', 'portfolio.currency', 'portfolio.calendar'] as const;
// Legacy property key for base currency — read alongside quovibe settings so the frontend
// can pre-populate the currency field after a fresh import (before the user saves via quovibe).
const PP_CURRENCY_KEY = 'baseCurrency';

export const portfolioRouter: RouterType = Router();

const getPortfolio: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);

  // Config entries (views, column widths, etc.)
  const rows = await db.select().from(configEntries);
  const config: Record<string, string | null> = {};
  for (const row of rows) {
    if (row.name != null) config[row.name] = row.data ?? null;
  }

  // quovibe own settings from property table
  const propKeys = [...QUOVIBE_SETTING_KEYS, PP_CURRENCY_KEY, 'provider.alphavantage.apiKey', 'provider.alphavantage.rateLimit'];
  const propRows = sqlite
    .prepare(`SELECT name, value FROM property WHERE name IN (${propKeys.map(() => '?').join(',')})`)
    .all(...propKeys) as { name: string; value: string }[];
  for (const row of propRows) {
    config[row.name] = row.value;
  }

  // Never expose the raw API key — only report whether one is configured
  const rawKey = config['provider.alphavantage.apiKey'];
  delete config['provider.alphavantage.apiKey'];
  config['hasAlphaVantageApiKey'] = rawKey ? 'true' : 'false';

  // Inject sidecar data into config map (serialized as strings for Record<string, string | null>)
  const settings = getSettings();
  const prefs = settings.preferences;
  // lastImport: backward-compatible key for frontend (ImportPage reads 'portfolio.lastImport')
  config['portfolio.lastImport'] = settings.app.lastImport;
  config['language'] = prefs.language;
  config['theme'] = prefs.theme;
  config['sharesPrecision'] = String(prefs.sharesPrecision);
  config['quotesPrecision'] = String(prefs.quotesPrecision);
  config['showCurrencyCode'] = String(prefs.showCurrencyCode);
  config['showPaSuffix'] = String(prefs.showPaSuffix);
  config['privacyMode'] = String(prefs.privacyMode);
  if (prefs.activeReportingPeriodId) {
    config['activeReportingPeriodId'] = prefs.activeReportingPeriodId;
  }
  if (prefs.defaultDataSeriesTaxonomyId) {
    config['defaultDataSeriesTaxonomyId'] = prefs.defaultDataSeriesTaxonomyId;
  }

  // Check if DB has any data (empty = bootstrap state, before first import)
  const accountCount = (sqlite
    .prepare('SELECT COUNT(*) as cnt FROM account')
    .get() as { cnt: number }).cnt;
  const initialized = getSettings().app.initialized;
  const empty = accountCount === 0 && !initialized;

  res.json({ config, empty });
};

const updateSettings: RequestHandler = async (req, res) => {
  const input = updateSettingsSchema.parse(req.body);
  const sqlite = getSqlite(req);
  const db = getDb(req);

  // Upsert into property table (no FK constraints, special=0 for app settings)
  const upsert = (key: string, value: string): void => {
    sqlite
      .prepare(`INSERT INTO property (name, special, value) VALUES (?, 0, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  };

  if (input.costMethod !== undefined) {
    upsert('portfolio.costMethod', input.costMethod);
  }
  if (input.currency !== undefined) {
    upsert('portfolio.currency', input.currency);
  }
  if (input.calendar !== undefined) {
    upsert('portfolio.calendar', input.calendar);
  }
  if (input.alphaVantageApiKey !== undefined) {
    upsert('provider.alphavantage.apiKey', input.alphaVantageApiKey);
  }
  if (input.alphaVantageRateLimit !== undefined) {
    upsert('provider.alphavantage.rateLimit', input.alphaVantageRateLimit);
  }

  // User-level sidecar fields (theme, language, activeReportingPeriodId, ...)
  // are written through PUT /api/settings/preferences; this portfolio-scoped
  // endpoint must not mutate user-global state (BUG-56). The shared schema
  // is .strict() so any sidecar field name in the body rejects with 400.

  // Return updated config (same shape as getPortfolio)
  const rows = await db.select().from(configEntries);
  const config: Record<string, string | null> = {};
  for (const row of rows) {
    if (row.name != null) config[row.name] = row.data ?? null;
  }
  const respPropKeys = [...QUOVIBE_SETTING_KEYS, PP_CURRENCY_KEY, 'provider.alphavantage.apiKey', 'provider.alphavantage.rateLimit'];
  const propRows = sqlite
    .prepare(`SELECT name, value FROM property WHERE name IN (${respPropKeys.map(() => '?').join(',')})`)
    .all(...respPropKeys) as { name: string; value: string }[];
  for (const row of propRows) {
    config[row.name] = row.value;
  }

  // Never expose the raw API key — only report whether one is configured
  const respRawKey = config['provider.alphavantage.apiKey'];
  delete config['provider.alphavantage.apiKey'];
  config['hasAlphaVantageApiKey'] = respRawKey ? 'true' : 'false';

  // Inject sidecar data (same as GET handler)
  const updatedSettings = getSettings();
  const updatedPrefs = updatedSettings.preferences;
  config['portfolio.lastImport'] = updatedSettings.app.lastImport;
  config['language'] = updatedPrefs.language;
  config['theme'] = updatedPrefs.theme;
  config['sharesPrecision'] = String(updatedPrefs.sharesPrecision);
  config['quotesPrecision'] = String(updatedPrefs.quotesPrecision);
  config['showCurrencyCode'] = String(updatedPrefs.showCurrencyCode);
  config['showPaSuffix'] = String(updatedPrefs.showPaSuffix);
  config['privacyMode'] = String(updatedPrefs.privacyMode);
  if (updatedPrefs.activeReportingPeriodId) {
    config['activeReportingPeriodId'] = updatedPrefs.activeReportingPeriodId;
  }
  if (updatedPrefs.defaultDataSeriesTaxonomyId) {
    config['defaultDataSeriesTaxonomyId'] = updatedPrefs.defaultDataSeriesTaxonomyId;
  }

  res.json({ config });
};

const exportDb: RequestHandler = async (req, res) => {
  const sqlite = getSqlite(req);
  const tempPath = path.join(os.tmpdir(), `portfolio-export-${Date.now()}.db`);
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.unlink(tempPath, () => { /* ignore errors */ });
  };

  try {
    await sqlite.backup(tempPath);
  } catch (err) {
    cleanup();
    const message = err instanceof Error ? err.message : 'Backup failed';
    res.status(500).json({ error: 'BACKUP_FAILED', details: message });
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="portfolio-${date}.db"`);

  res.on('close', cleanup);

  const stream = fs.createReadStream(tempPath);
  stream.on('error', (err) => {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'STREAM_FAILED', details: err.message });
    }
  });
  stream.pipe(res);
};

const initPortfolio: RequestHandler = async (_req, res) => {
  updateAppState({ initialized: true });
  res.json({ ok: true });
};

portfolioRouter.get('/', getPortfolio);
portfolioRouter.post('/init', initPortfolio);
portfolioRouter.put('/settings', updateSettings);
portfolioRouter.get('/export', exportDb);
