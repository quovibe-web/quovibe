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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-prefs-test-'));
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

describe('GET /api/settings', () => {
  itIfSqlite('returns { preferences, app } with defaults when sidecar is empty', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('preferences');
    expect(res.body).toHaveProperty('app');
    expect(res.body.preferences.language).toBe('en');
    expect(res.body.preferences.theme).toBe('system');
    expect(res.body.preferences.sharesPrecision).toBe(1);
    expect(res.body.preferences.quotesPrecision).toBe(2);
    expect(res.body.app.autoFetchPricesOnFirstOpen).toBe(false);
  });
});

describe('PUT /api/settings/preferences', () => {
  itIfSqlite('partial-merges language and round-trips via GET', async () => {
    const app = await buildApp();

    const put = await request(app)
      .put('/api/settings/preferences')
      .send({ language: 'it' });

    expect(put.status).toBe(200);
    expect(put.body.language).toBe('it');
    // unrelated defaults are preserved
    expect(put.body.theme).toBe('system');
    expect(put.body.sharesPrecision).toBe(1);

    const get = await request(app).get('/api/settings');
    expect(get.body.preferences.language).toBe('it');
  });

  itIfSqlite('accepts theme changes', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/settings/preferences')
      .send({ theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('dark');
  });

  itIfSqlite('accepts sharesPrecision / quotesPrecision within bounds', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/settings/preferences')
      .send({ sharesPrecision: 4, quotesPrecision: 6 });
    expect(res.status).toBe(200);
    expect(res.body.sharesPrecision).toBe(4);
    expect(res.body.quotesPrecision).toBe(6);
  });

  itIfSqlite('rejects out-of-range sharesPrecision with 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/settings/preferences')
      .send({ sharesPrecision: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PREFERENCES');
  });

  itIfSqlite('rejects invalid theme with 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/settings/preferences')
      .send({ theme: 'neon' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PREFERENCES');
  });

  itIfSqlite('does not touch app fields like autoFetchPricesOnFirstOpen', async () => {
    const app = await buildApp();

    // Seed autoFetch via the dedicated endpoint
    await request(app)
      .put('/api/settings/auto-fetch')
      .send({ autoFetchPricesOnFirstOpen: true });

    // Now mutate preferences
    await request(app)
      .put('/api/settings/preferences')
      .send({ privacyMode: true });

    const get = await request(app).get('/api/settings');
    expect(get.body.app.autoFetchPricesOnFirstOpen).toBe(true);
    expect(get.body.preferences.privacyMode).toBe(true);
  });
});
