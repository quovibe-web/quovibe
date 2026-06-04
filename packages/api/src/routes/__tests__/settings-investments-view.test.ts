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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-iv-test-'));
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

describe('GET /api/settings/investments-view', () => {
  itIfSqlite('returns holdingsFilter=all by default', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/settings/investments-view');
    expect(res.status).toBe(200);
    expect(res.body.holdingsFilter).toBe('all');
  });
});

describe('PUT /api/settings/investments-view', () => {
  itIfSqlite('persists holdingsFilter=held and round-trips via GET', async () => {
    const app = await buildApp();

    const putRes = await request(app)
      .put('/api/settings/investments-view')
      .send({ holdingsFilter: 'held' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.holdingsFilter).toBe('held');

    const getRes = await request(app).get('/api/settings/investments-view');
    expect(getRes.status).toBe(200);
    expect(getRes.body.holdingsFilter).toBe('held');
  });

  itIfSqlite('rejects an invalid holdingsFilter with 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/settings/investments-view')
      .send({ holdingsFilter: 'sold' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });
});
