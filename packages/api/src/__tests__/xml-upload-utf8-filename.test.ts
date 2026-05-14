// BUG-176 regression: busboy decodes Content-Disposition `filename=` as
// latin1 by default; browsers send UTF-8 bytes, so non-ASCII filenames
// (`próbaID.xml`) round-trip on disk as `prÃ³baID.xml`. Class fix is
// `defParamCharset: 'utf8'` on the multer config. This test mocks
// runImport so the upload file is observable on disk before the service
// would otherwise unlink it, then asserts the saved filename preserves
// UTF-8 (no mojibake).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xml-utf8-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

const capturedFiles: string[] = [];

// Snapshot the upload directory on the first runImport call (before the
// service's finally-block unlinks the temp XML), then throw so the test
// stays in the CONVERSION_FAILED branch.
vi.mock('../services/import.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/import.service')>();
  return {
    ...actual,
    runImport: vi.fn(async (xmlPath: string) => {
      const dir = path.dirname(xmlPath);
      for (const name of fs.readdirSync(dir)) capturedFiles.push(name);
      throw new actual.ImportError('CONVERSION_FAILED', 'mock');
    }),
  };
});

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

describe('POST /api/import/xml UTF-8 filename preservation (BUG-176)', () => {
  it('preserves non-ASCII characters on the saved upload filename', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    capturedFiles.length = 0;

    const xml = '<?xml version="1.0"?><client><account id="a1"/></client>';

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from(xml), {
        filename: 'próbaID.xml',
        contentType: 'application/xml',
      });

    // Mocked runImport throws CONVERSION_FAILED — that's expected and
    // unrelated to the filename assertion below.
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('CONVERSION_FAILED');

    // The saved filename must round-trip the original UTF-8 bytes. With
    // defParamCharset='utf8' on multer, busboy decodes correctly and the
    // disk filename ends in `próbaID.xml`. Without it (regression), the
    // file would land as `prÃ³baID.xml`.
    expect(
      capturedFiles.some((f) => f.includes('próbaID.xml')),
      `expected a file ending in 'próbaID.xml'; saw ${JSON.stringify(capturedFiles)}`,
    ).toBe(true);
    expect(
      capturedFiles.every((f) => !f.includes('prÃ³baID')),
      `mojibake regression — saw 'prÃ³baID' fragment in ${JSON.stringify(capturedFiles)}`,
    ).toBe(true);
  });
});
