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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-av-test-'));
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

describe('GET /api/settings/allocation-view', () => {
  itIfSqlite('returns defaults when the sidecar is empty', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/settings/allocation-view');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chartMode: 'pie' });
  });
});

describe('PUT /api/settings/allocation-view', () => {
  itIfSqlite('persists chartMode=treemap and round-trips via GET', async () => {
    const app = await buildApp();

    const putRes = await request(app)
      .put('/api/settings/allocation-view')
      .send({ chartMode: 'treemap' });

    expect(putRes.status).toBe(200);
    expect(putRes.body.chartMode).toBe('treemap');

    const getRes = await request(app).get('/api/settings/allocation-view');
    expect(getRes.status).toBe(200);
    expect(getRes.body.chartMode).toBe('treemap');
  });

  itIfSqlite('rejects an invalid chartMode with 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/settings/allocation-view')
      .send({ chartMode: 'donut' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ALLOCATION_VIEW');
  });

  itIfSqlite('partial-merges without touching investmentsView', async () => {
    const app = await buildApp();

    // Seed investmentsView to a non-default value first
    await request(app).put('/api/settings/investments-view').send({ chartMode: 'off' });
    // Now mutate allocationView
    await request(app).put('/api/settings/allocation-view').send({ chartMode: 'treemap' });

    const iv = await request(app).get('/api/settings/investments-view');
    expect(iv.body.chartMode).toBe('off');
  });
});
