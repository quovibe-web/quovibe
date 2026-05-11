// Wire-contract governance: BOTH import routes' 201 bodies must conform to
// the shared importResponseSchema (which uses importSummarySchema for the
// summary leaf). If either route drifts in structure, this test catches it.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { importSummarySchema } from '@quovibe/shared';
import { buildQuovibeBackupDb } from '../services/__tests__/_helpers/build-backup-db';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-import-shape-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
// Per-suite import lock so parallel test files don't clobber each other.
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

// Server response envelope — pinned here as governance against drift.
// Both import routes must conform to this shape.
const importResponseSchema = z.object({
  entry: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    kind: z.enum(['real', 'demo']),
    source: z.enum(['fresh', 'demo', 'import-pp-xml', 'import-quovibe-db']),
    createdAt: z.string(),
    lastOpenedAt: z.string().nullable(),
  }),
  summary: importSummarySchema,
  alreadyExisted: z.boolean().optional(),
});

// Mock runImport to succeed without Python. The returned tempDbPath must
// point to a real bootstrapped SQLite DB because createImportedPpxmlImpl
// opens it to compute the ImportSummary COUNTs.
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
    // Seed the portfolio name so createImportedPpxmlImpl doesn't fail.
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

describe('Import response envelope — governance', () => {
  it('POST /api/import/xml conforms to {entry, summary}', async () => {
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

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(201);
    expect(() => importResponseSchema.parse(res.body)).not.toThrow();
  });

  it('POST /api/portfolios .db branch conforms to {entry, summary, alreadyExisted?}', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const sourcePath = buildQuovibeBackupDb({
      name: `Backup-${Date.now()}`,
      depositAccounts: 1,
      securities: 2,
      transactions: 4,
    });

    const res = await request(app)
      .post('/api/portfolios')
      .attach('file', sourcePath);

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(201);
    expect(() => importResponseSchema.parse(res.body)).not.toThrow();
  });
});
