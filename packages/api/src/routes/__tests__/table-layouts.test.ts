import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { createApp } from '../../create-app';

let tempDir: string;
let app: ReturnType<typeof createApp>;

// Check if native sqlite bindings are available
let hasSqliteBindings = false;
try { new Database(':memory:').close(); hasSqliteBindings = true; } catch { /* skip */ }

const itIfSqlite = hasSqliteBindings ? it : it.skip;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-tl-test-'));
  process.env.QUOVIBE_DATA_DIR = tempDir;

  vi.resetModules();

  const settingsMod = await import('../../services/settings.service');
  settingsMod.loadSettings();

  const mod = await import('../../create-app');
  app = mod.createApp();
});

afterEach(() => {
  vi.resetModules();
  delete process.env.QUOVIBE_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('GET /api/settings/table-layouts/:tableId', () => {
  itIfSqlite('returns empty defaults for unknown (but valid) tableId', async () => {
    const res = await request(app).get('/api/settings/table-layouts/transactions');
    expect(res.status).toBe(200);
    expect(res.body.columnOrder).toEqual([]);
    expect(res.body.columnSizing).toEqual({});
  });

  itIfSqlite('returns 400 for invalid tableId', async () => {
    const res = await request(app).get('/api/settings/table-layouts/A_INVALID');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TABLE_ID');
  });

  itIfSqlite('returns new fields (sorting, columnVisibility, version) with defaults', async () => {
    const res = await request(app).get('/api/settings/table-layouts/transactions');
    expect(res.status).toBe(200);
    expect(res.body.sorting).toBeNull();
    expect(res.body.columnVisibility).toBeNull();
    expect(res.body.version).toBe(1);
  });
});

describe('PUT /api/settings/table-layouts/:tableId', () => {
  itIfSqlite('saves and retrieves columnOrder', async () => {
    await request(app)
      .put('/api/settings/table-layouts/transactions')
      .send({ columnOrder: ['date', 'type', 'amount'] });

    const res = await request(app).get('/api/settings/table-layouts/transactions');
    expect(res.status).toBe(200);
    expect(res.body.columnOrder).toEqual(['date', 'type', 'amount']);
  });

  itIfSqlite('saves and retrieves columnSizing', async () => {
    await request(app)
      .put('/api/settings/table-layouts/transactions')
      .send({ columnSizing: { date: 120, type: 90 } });

    const res = await request(app).get('/api/settings/table-layouts/transactions');
    expect(res.body.columnSizing).toEqual({ date: 120, type: 90 });
  });

  itIfSqlite('partial PUT preserves existing fields', async () => {
    await request(app)
      .put('/api/settings/table-layouts/transactions')
      .send({ columnOrder: ['date', 'type'], columnSizing: { date: 100 } });

    // Update only sizing — order must be preserved
    await request(app)
      .put('/api/settings/table-layouts/transactions')
      .send({ columnSizing: { date: 150 } });

    const res = await request(app).get('/api/settings/table-layouts/transactions');
    expect(res.body.columnOrder).toEqual(['date', 'type']);
    expect(res.body.columnSizing).toEqual({ date: 150 });
  });

  itIfSqlite('saves and retrieves sorting state', async () => {
    await request(app)
      .put('/api/settings/table-layouts/transactions')
      .send({ sorting: [{ id: 'date', desc: true }] });

    const res = await request(app).get('/api/settings/table-layouts/transactions');
    expect(res.body.sorting).toEqual([{ id: 'date', desc: true }]);
  });

  itIfSqlite('saves and retrieves columnVisibility', async () => {
    await request(app)
      .put('/api/settings/table-layouts/investments')
      .send({ columnVisibility: { marketValue: true, irr: false, ttwror: true } });

    const res = await request(app).get('/api/settings/table-layouts/investments');
    expect(res.body.columnVisibility).toEqual({ marketValue: true, irr: false, ttwror: true });
  });

  itIfSqlite('returns 400 for invalid tableId', async () => {
    const res = await request(app)
      .put('/api/settings/table-layouts/A_INVALID')
      .send({ columnOrder: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TABLE_ID');
  });

  itIfSqlite('accepts any valid tableId matching regex pattern', async () => {
    const ids = ['investments', 'transactions', 'security-detail', 'account-transactions', 'cash-transactions'];
    for (const id of ids) {
      const res = await request(app)
        .put(`/api/settings/table-layouts/${id}`)
        .send({ columnOrder: [] });
      expect(res.status).toBe(200);
    }
  });
});

describe('DELETE /api/settings/table-layouts/:tableId', () => {
  itIfSqlite('deletes a table layout and resets to defaults', async () => {
    // Save some state first
    await request(app)
      .put('/api/settings/table-layouts/transactions')
      .send({ sorting: [{ id: 'date', desc: true }], columnOrder: ['date', 'amount'] });

    // Delete it
    const delRes = await request(app).delete('/api/settings/table-layouts/transactions');
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // Verify it returns defaults
    const res = await request(app).get('/api/settings/table-layouts/transactions');
    expect(res.body.columnOrder).toEqual([]);
    expect(res.body.sorting).toBeNull();
  });

  itIfSqlite('returns 400 for invalid tableId', async () => {
    const res = await request(app).delete('/api/settings/table-layouts/A_INVALID');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TABLE_ID');
  });

  itIfSqlite('returns ok even if tableId does not exist', async () => {
    const res = await request(app).delete('/api/settings/table-layouts/nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
