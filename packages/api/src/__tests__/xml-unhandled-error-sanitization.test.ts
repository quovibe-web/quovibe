// BUG-94 / BUG-96 regression: when runImport throws something other than
// ImportError or PortfolioManagerError (e.g., the original rename-race
// ENOENT, any future fs/runtime exception), the route's outer catch must
// log it server-side and respond with a bare {error:'CONVERSION_FAILED'}.
// The previous code had `details: process.env.NODE_ENV === 'production'
// ? 'Internal server error' : String(err)`, which leaked the raw errno
// string with the absolute path on packaged-desktop builds (NODE_ENV is
// not `production` outside CI).
//
// Scoped to the uploadXml outer-catch fallback; works deterministically
// in CI without Python.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xml-unhandled-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
// Per-suite import lock so parallel test files don't clobber each other.
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

// Mock runImport to throw a surprise non-ImportError carrying a Windows-style
// absolute path. isImportInProgress + ImportError are re-exported from the
// real module so the route-level lock check + error-type dispatch keep
// working; only runImport is replaced.
vi.mock('../services/import.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/import.service')>();
  return {
    ...actual,
    runImport: vi.fn().mockRejectedValue(
      new Error("leak-this ENOENT: no such file or directory, rename 'C:\\quovibe\\data\\tmp\\secret.xml'"),
    ),
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

describe('POST /api/import/xml outer-catch sanitization (BUG-94 / BUG-96)', () => {
  it('non-ImportError thrown from runImport maps to bare CONVERSION_FAILED with no details and no path leak', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    // Content doesn't matter beyond passing multer — the mocked runImport
    // throws before the validator runs.
    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from('<?xml version="1.0"?><client><account id="a1"/></client>'), {
        filename: 'probe.xml',
        contentType: 'application/xml',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(500);
    expect(res.body).toEqual({ error: 'CONVERSION_FAILED' });
    expect(res.body.details, 'uploadXml outer-catch must not carry details (BUG-96)').toBeUndefined();

    const haystack = JSON.stringify(res.body) + (res.text ?? '');
    const leakPatterns: readonly RegExp[] = [
      /leak-this/,
      /ENOENT/,
      /C:\\quovibe/,
      /data\\tmp/,
      /secret\.xml/,
    ];
    for (const pat of leakPatterns) {
      expect(haystack, `response leaked ${pat}: ${haystack}`).not.toMatch(pat);
    }
  });
});
