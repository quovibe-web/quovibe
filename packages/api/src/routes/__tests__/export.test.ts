import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

/**
 * Creates a file-backed test DB with minimal schema.
 * We need a real file (not :memory:) because .backup() writes to disk.
 */
function createFileTestDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS property (
      name TEXT PRIMARY KEY,
      special INTEGER NOT NULL DEFAULT 0,
      value TEXT NOT NULL
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe.skipIf(!hasSqliteBindings)('GET /api/portfolio/export', () => {
  const tmpDbPath = path.join(os.tmpdir(), `export-test-${Date.now()}.db`);

  let app: ReturnType<typeof createApp>;
  let sqlite: ReturnType<typeof createFileTestDb>['sqlite'];

  beforeAll(() => {
    const handle = createFileTestDb(tmpDbPath);
    sqlite = handle.sqlite;
    sqlite.exec("INSERT INTO property (name, special, value) VALUES ('test.export', 0, 'exported-ok')");
    app = createApp(handle.db, handle.sqlite);
  });

  afterAll(() => {
    try { sqlite.close(); } catch { /* ok */ }
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + ext); } catch { /* ok */ }
    }
  });

  it('returns a valid SQLite file with correct headers', async () => {
    const res = await request(app)
      .get('/api/portfolio/export')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toBe('application/x-sqlite3');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="portfolio-\d{4}-\d{2}-\d{2}\.db"/);

    // Write response body to temp file and verify it's a valid SQLite DB
    const exportedPath = path.join(os.tmpdir(), `export-verify-${Date.now()}.db`);
    fs.writeFileSync(exportedPath, res.body);

    const exportedDb = new Database(exportedPath, { readonly: true });
    const row = exportedDb.prepare("SELECT value FROM property WHERE name = 'test.export'").get() as { value: string } | undefined;
    exportedDb.close();
    fs.unlinkSync(exportedPath);

    expect(row?.value).toBe('exported-ok');
  });

  it('includes WAL data that has not been checkpointed', async () => {
    sqlite.exec("INSERT INTO property (name, special, value) VALUES ('test.wal', 0, 'wal-data') ON CONFLICT(name) DO UPDATE SET value = 'wal-data'");

    const res = await request(app)
      .get('/api/portfolio/export')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const exportedPath = path.join(os.tmpdir(), `export-wal-${Date.now()}.db`);
    fs.writeFileSync(exportedPath, res.body);

    const exportedDb = new Database(exportedPath, { readonly: true });
    const row = exportedDb.prepare("SELECT value FROM property WHERE name = 'test.wal'").get() as { value: string } | undefined;
    exportedDb.close();
    fs.unlinkSync(exportedPath);

    expect(row?.value).toBe('wal-data');
  });
});
