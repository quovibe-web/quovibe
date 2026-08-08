// The PP-XML import result must be an {entry, summary} envelope, not the
// legacy flat {status, id, accounts, securities}. Conversion is detached from
// the upload request, so the envelope arrives on the job rather than in the
// POST body. runImport is mocked so the route's portfolio-creation +
// summary-collection path is exercised end-to-end without Python in CI.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { importSummarySchema } from '@quovibe/shared';
import { pollImportJob } from './_helpers/poll-import-job';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xml-shape-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
// Per-suite import lock so parallel test files don't clobber each other.
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

// Mock runImport to succeed without Python. The returned tempDbPath must
// point to a real bootstrapped SQLite DB because createImportedPpxmlImpl
// opens it to compute the ImportSummary COUNTs. An empty bootstrapped DB
// yields counts of 0 which satisfies importSummarySchema (nonnegative).
vi.mock('../services/import.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/import.service')>();
  const { applyBootstrap } = await import('../db/apply-bootstrap');
  const { mkdtempSync: mkd } = await import('fs');
  const { tmpdir: osTmpdir } = await import('os');
  const BetterSqlite = (await import('better-sqlite3')).default;

  const dbDir = mkd(path.join(osTmpdir(), 'qv-shape-db-'));
  const tempDbPath = path.join(dbDir, 'imported.db');
  const db = new BetterSqlite(tempDbPath);
  try {
    applyBootstrap(db);
    // Seed the portfolio name so createImportedPpxmlImpl doesn't fail on a
    // missing name key (it reads vf_portfolio_meta WHERE key='name').
    db.exec("INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('name', 'Test Import')");
  } finally {
    db.close();
  }

  return {
    ...actual,
    runImport: vi.fn().mockResolvedValue({ tempDbPath }),
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

describe('POST /api/import/xml — response shape', () => {
  it('returns {entry, summary} envelope on success', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    // Content passes multer's fileFilter; the mocked runImport fires before
    // ppxml2db would be invoked, so the XML doesn't need to be real.
    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from('<?xml version="1.0"?><client><account id="a1"/></client>'), {
        filename: 'test-import.xml',
        contentType: 'application/xml',
      });

    // The upload only acknowledges acceptance; the envelope lands on the job.
    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(202);
    const job = await pollImportJob(app, res.body.jobId);
    expect(job.state, JSON.stringify(job)).toBe('done');

    const result = job.result as Record<string, unknown>;
    expect(result).toMatchObject({
      entry: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: expect.any(String),
        kind: 'real',
        source: 'import-pp-xml',
        createdAt: expect.any(String),
        lastOpenedAt: null,
      },
    });

    // Summary parses cleanly through the shared Zod schema.
    expect(() => importSummarySchema.parse(result.summary)).not.toThrow();

    // No legacy flat fields left over.
    expect(result.id, 'legacy flat id must be absent').toBeUndefined();
    expect(result.status, 'legacy flat status must be absent').toBeUndefined();
    expect(result.accounts, 'legacy flat accounts must be absent').toBeUndefined();
    expect(result.securities, 'legacy flat securities must be absent').toBeUndefined();
    expect(result.name, 'legacy flat name must be absent').toBeUndefined();
  });
});
