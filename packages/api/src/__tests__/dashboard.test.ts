import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';

let tempDir: string;
let tempDbPath: string;
let sidecarPath: string;
let app: express.Express;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-dashboard-test-'));
  tempDbPath = path.join(tempDir, 'portfolio.db');
  sidecarPath = path.join(tempDir, 'quovibe.settings.json');

  vi.resetModules();
  vi.doMock('../config', () => ({
    DB_PATH: tempDbPath,
    DB_BACKUP_MAX: 3,
    SCHEMA_PATH: path.join(tempDir, 'schema.db'),
  }));

  // Load settings service after mock
  const { loadSettings } = await import('../services/settings.service');
  loadSettings();

  // Build a minimal Express app with just the dashboard router
  const { dashboardRouter } = await import('../routes/dashboard');
  app = express();
  app.use(express.json());
  app.use('/api/dashboard', dashboardRouter);
});

afterEach(() => {
  vi.resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('GET /api/dashboard', () => {
  test('returns empty defaults when sidecar has no dashboards', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.dashboards).toEqual([]);
    expect(res.body.activeDashboard).toBeNull();
  });

  test('returns stored dashboards from sidecar', async () => {
    const sidecar = {
      version: 1,
      app: { lastImport: null, appVersion: null },
      preferences: { language: 'en', theme: 'system', sharesPrecision: 1, quotesPrecision: 2, showCurrencyCode: false, showPaSuffix: true, privacyMode: false },
      reportingPeriods: [],
      dashboards: [{ id: 'd1', name: 'Main', widgets: [{ id: 'w1', type: 'ttwror', title: null, span: 1, config: {} }] }],
      activeDashboard: 'd1',
    };
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar), 'utf-8');

    // Reload settings with the file present
    const { loadSettings } = await import('../services/settings.service');
    loadSettings();

    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.dashboards).toHaveLength(1);
    expect(res.body.dashboards[0].name).toBe('Main');
    expect(res.body.activeDashboard).toBe('d1');
  });
});

describe('PUT /api/dashboard', () => {
  test('validates and persists valid config', async () => {
    const body = {
      dashboards: [
        { id: 'd1', name: 'My Dashboard', widgets: [{ id: 'w1', type: 'irr' }] },
      ],
      activeDashboard: 'd1',
    };

    const res = await request(app).put('/api/dashboard').send(body);
    expect(res.status).toBe(200);
    expect(res.body.dashboards).toHaveLength(1);
    expect(res.body.dashboards[0].widgets[0].span).toBe(1); // default applied
    expect(res.body.activeDashboard).toBe('d1');

    // Verify persistence
    const getRes = await request(app).get('/api/dashboard');
    expect(getRes.body.dashboards).toHaveLength(1);
  });

  test('rejects invalid span', async () => {
    const body = {
      dashboards: [
        { id: 'd1', name: 'Bad', widgets: [{ id: 'w1', type: 'x', span: 4 }] },
      ],
      activeDashboard: 'd1',
    };

    const res = await request(app).put('/api/dashboard').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_DASHBOARD_CONFIG');
  });

  test('rejects missing dashboards array', async () => {
    const res = await request(app).put('/api/dashboard').send({ activeDashboard: 'd1' });
    expect(res.status).toBe(400);
  });

  test('rejects widget missing id', async () => {
    const body = {
      dashboards: [
        { id: 'd1', name: 'Bad', widgets: [{ type: 'ttwror' }] },
      ],
      activeDashboard: null,
    };

    const res = await request(app).put('/api/dashboard').send(body);
    expect(res.status).toBe(400);
  });

  test('allows setting activeDashboard to null', async () => {
    const body = { dashboards: [], activeDashboard: null };
    const res = await request(app).put('/api/dashboard').send(body);
    expect(res.status).toBe(200);
    expect(res.body.activeDashboard).toBeNull();
  });
});
