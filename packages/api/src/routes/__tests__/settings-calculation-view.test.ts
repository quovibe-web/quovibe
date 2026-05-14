import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import Database from 'better-sqlite3';

// Check if native sqlite bindings are available
let hasSqliteBindings = false;
try { new Database(':memory:').close(); hasSqliteBindings = true; } catch { /* skip */ }

const itIfSqlite = hasSqliteBindings ? it : it.skip;

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-calc-view-test-'));
  process.env.QUOVIBE_DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  delete process.env.QUOVIBE_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function buildApp() {
  const { createApp } = await import('../../create-app');
  const { loadSettings } = await import('../../services/settings.service');
  loadSettings();
  return createApp();
}

describe('GET /api/settings/calculation-view', () => {
  itIfSqlite('returns defaults when sidecar has no entry', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/settings/calculation-view');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ layout: 'premium', tableDensity: 'comfortable' });
  });
});

describe('PUT /api/settings/calculation-view', () => {
  itIfSqlite('persists layout change and GET confirms persistence', async () => {
    const app = await buildApp();

    const put = await request(app)
      .put('/api/settings/calculation-view')
      .send({ layout: 'classic' });

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ layout: 'classic', tableDensity: 'comfortable' });

    const get = await request(app).get('/api/settings/calculation-view');
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ layout: 'classic', tableDensity: 'comfortable' });
  });

  itIfSqlite('partial-merges tableDensity while preserving existing layout', async () => {
    const app = await buildApp();

    // First set layout to classic
    await request(app)
      .put('/api/settings/calculation-view')
      .send({ layout: 'classic' });

    // Then partial-merge tableDensity only
    const put = await request(app)
      .put('/api/settings/calculation-view')
      .send({ tableDensity: 'dense' });

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ layout: 'classic', tableDensity: 'dense' });
  });

  itIfSqlite('returns 400 with INVALID_CALCULATION_VIEW for unknown layout value', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/settings/calculation-view')
      .send({ layout: 'rainbow' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CALCULATION_VIEW');
  });
});
