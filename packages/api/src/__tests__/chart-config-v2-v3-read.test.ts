// packages/api/src/__tests__/chart-config-v2-v3-read.test.ts
//
// Regression lock for Phase 2.2: GET /api/settings/chart-config must return
// v3 even when the sidecar contains a v2 chartConfig. PUT must accept both
// v2 and v3 and always return v3.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

// Env wiring BEFORE any deferred `await import(...)` resolves `../config`.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-cc-v3-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

const sidecarPath = path.join(tmp, 'quovibe.settings.json');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
  ({ createApp } = await import('../create-app'));
  ({ loadSettings } = await import('../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../services/boot-recovery'));
  await import('../services/portfolio-registry');
});

beforeEach(() => {
  // Reset sidecar before each test.
  if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
  loadSettings();
  recoverFromInterruptedSwap();
});

/** Write a raw JSON blob to the sidecar so tests can seed arbitrary stored shapes. */
function writeSidecar(data: object): void {
  fs.writeFileSync(sidecarPath, JSON.stringify(data, null, 2), 'utf-8');
}

describe('GET /api/settings/chart-config — v2 → v3 migration', () => {
  it('returns v3 with axis and role fields when stored config is v2', async () => {
    writeSidecar({
      schemaVersion: 1,
      chartConfig: {
        version: 2,
        series: [
          { id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null },
          { id: 'b1', type: 'benchmark', visible: false, lineStyle: 'dashed', color: '#ff0000', securityId: 'sec-1' },
        ],
      },
    });
    // loadSettings migrates v2 → v3 in-memory; GET should return v3.
    loadSettings();
    const app = createApp();

    const res = await request(app).get('/api/settings/chart-config');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.series).toHaveLength(2);
    expect(res.body.series[0].axis).toBe('auto');
    expect(res.body.series[0].role).toBe('portfolio');
    expect(res.body.series[1].axis).toBe('auto');
    expect(res.body.series[1].role).toBe('reference'); // benchmark → reference
  });

  it('persists the v3 upgrade to disk on loadSettings (so subsequent cold reads skip migration)', async () => {
    writeSidecar({
      schemaVersion: 1,
      chartConfig: {
        version: 2,
        series: [{ id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null }],
      },
    });
    // loadSettings migrates v2→v3 in-memory AND flushes to disk.
    loadSettings();

    // Read the sidecar back and confirm it was rewritten as v3 without needing a GET.
    const stored = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(stored.chartConfig.version).toBe(3);
    expect(stored.chartConfig.series[0].axis).toBe('auto');

    // GET also returns v3 (from in-memory cache, which is already upgraded).
    const app = createApp();
    const res = await request(app).get('/api/settings/chart-config');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
  });

  it('returns v3 directly when stored config is already v3', async () => {
    writeSidecar({
      schemaVersion: 1,
      chartConfig: {
        version: 3,
        series: [{ id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null, axis: 'left', role: 'portfolio' }],
      },
    });
    loadSettings();
    const app = createApp();

    const res = await request(app).get('/api/settings/chart-config');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.series[0].axis).toBe('left'); // user-set, preserved
    expect(res.body.series[0].role).toBe('portfolio');
  });

  it('returns default v3 envelope when no chart config exists in sidecar', async () => {
    // sidecar deleted in beforeEach, loadSettings() called → DEFAULT_SETTINGS.
    const app = createApp();
    const res = await request(app).get('/api/settings/chart-config');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    // DEFAULT_CHART_CONFIG has a single portfolio series; empty series is also valid.
    expect(Array.isArray(res.body.series)).toBe(true);
  });
});

describe('PUT /api/settings/chart-config — accepts v2 and v3', () => {
  it('accepts v3 body and stores v3', async () => {
    const app = createApp();
    const v3body = {
      version: 3,
      series: [
        { id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null, axis: 'right', role: 'portfolio' },
      ],
    };
    const res = await request(app).put('/api/settings/chart-config').send(v3body);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.series[0].axis).toBe('right');
    expect(res.body.series[0].role).toBe('portfolio');
  });

  it('accepts v2 body and returns v3 (transparent migration)', async () => {
    const app = createApp();
    const v2body = {
      version: 2,
      series: [
        { id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null },
        { id: 'b1', type: 'benchmark', visible: true, lineStyle: 'dashed', color: null, securityId: 'sec-1' },
      ],
    };
    const res = await request(app).put('/api/settings/chart-config').send(v2body);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.series).toHaveLength(2);
    expect(res.body.series[0].axis).toBe('auto');
    expect(res.body.series[0].role).toBe('portfolio');
    expect(res.body.series[1].axis).toBe('auto');
    expect(res.body.series[1].role).toBe('reference');
  });

  it('persists v3 to sidecar when a v2 body is PUT', async () => {
    const app = createApp();
    const v2body = {
      version: 2,
      series: [{ id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null }],
    };
    await request(app).put('/api/settings/chart-config').send(v2body);

    const stored = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(stored.chartConfig.version).toBe(3);
    expect(stored.chartConfig.series[0].axis).toBe('auto');
  });

  it('returns 400 INVALID_CHART_CONFIG for an invalid body', async () => {
    const app = createApp();
    const res = await request(app).put('/api/settings/chart-config').send({ version: 99, series: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CHART_CONFIG');
  });

  it('returns 400 for a body missing version', async () => {
    const app = createApp();
    const res = await request(app).put('/api/settings/chart-config').send({ series: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CHART_CONFIG');
  });

  it('subsequent GET after v2 PUT returns v3', async () => {
    const app = createApp();
    const v2body = {
      version: 2,
      series: [{ id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null }],
    };
    await request(app).put('/api/settings/chart-config').send(v2body);
    const getRes = await request(app).get('/api/settings/chart-config');
    expect(getRes.status).toBe(200);
    expect(getRes.body.version).toBe(3);
  });
});

describe('loadSettings — sidecar v2 migration preserves other settings fields', () => {
  it('migrates v2 chartConfig without losing reportingPeriods', async () => {
    // Write a sidecar that has v2 chartConfig AND reportingPeriods — confirms
    // the migration does not trigger the "failed to parse → reset to defaults" catch branch.
    writeSidecar({
      schemaVersion: 1,
      chartConfig: {
        version: 2,
        series: [{ id: 'p1', type: 'portfolio', visible: true, lineStyle: 'solid', color: null }],
      },
      reportingPeriods: [{ type: 'lastDays', days: 30 }],
    });
    loadSettings();
    const app = createApp();

    const res = await request(app).get('/api/settings/chart-config');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);

    // Also verify the reporting period was not lost.
    const periodsRes = await request(app).get('/api/settings/reporting-periods');
    expect(periodsRes.status).toBe(200);
    expect(periodsRes.body.periods).toHaveLength(1);
    expect(periodsRes.body.periods[0].definition.type).toBe('lastDays');
  });
});
