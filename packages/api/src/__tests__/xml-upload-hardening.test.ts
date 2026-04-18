// Regression harness for BUG-09: POST /api/import/xml accepted files that
// bypassed the `accept=".xml"` browser hint (drag-and-drop, renamed binaries,
// programmatic uploads). The route now translates multer fileFilter /
// LIMIT_FILE_SIZE failures into structured ImportError codes that handleError
// maps to 400. Any regression that drops the uploadSingle wrapper or reverts
// the error codes will fail these tests.
//
// Parallels `csv-upload-hardening.test.ts` (BUG-46). Same shape, XML surface.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xml-hard-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
// Cap uploads at 1 MB for this suite so the oversize case stays lightweight.
process.env.IMPORT_MAX_MB = '1';

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

describe('POST /api/import/xml boundary hardening (BUG-09)', () => {
  it('non-.xml extension returns 400 INVALID_FILE_FORMAT, not 500', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from('This is not XML\njust text pretending to be an executable'), {
        filename: 'fake.exe',
        contentType: 'application/octet-stream',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe('INVALID_FILE_FORMAT');
  });

  it('file over the upload limit returns 400 FILE_TOO_LARGE, not 500', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    // 2 MB — past the 1 MB IMPORT_MAX_MB cap set at suite start.
    const oversized = Buffer.alloc(2 * 1024 * 1024, 0x61); // native-ok

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', oversized, {
        filename: 'too-big.xml',
        contentType: 'application/xml',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe('FILE_TOO_LARGE');
  });

  it('missing file field returns 400 NO_FILE (regression guard)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const res = await request(app)
      .post('/api/import/xml')
      .field('name', 'Imported');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_FILE');
  });

  it('uppercase .XML extension clears the fileFilter (case-insensitive match)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from('<wrong-root/>'), {
        filename: 'EXPORT.XML',
        contentType: 'application/xml',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).not.toBe(500);
    expect(res.body.error).not.toBe('INVALID_FILE_FORMAT');
  });

  it('valid .xml clears the multer boundary (no 500, no boundary-error code)', async () => {
    // We cannot run ppxml2db in Vitest (no Python in CI). This test only proves
    // the multer boundary was cleared — the request reached the route handler
    // and the downstream validator/Python rejected it with a non-boundary code.
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const xml = '<wrong-root/>';

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from(xml), {
        filename: 'wrong-root.xml',
        contentType: 'application/xml',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).not.toBe(500);
    expect(['INVALID_FILE_FORMAT', 'FILE_TOO_LARGE', 'NO_FILE']).not.toContain(res.body.error);
  });
});
