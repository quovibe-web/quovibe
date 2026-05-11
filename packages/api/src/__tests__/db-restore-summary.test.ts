// POST /api/portfolios multipart (.db restore) 201 must include the
// {entry, summary} envelope. No subprocess mock — the .db branch passes
// the file directly to createImportedQuovibeDbImpl; no Python conversion.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { importSummarySchema } from '@quovibe/shared';
import { buildQuovibeBackupDb } from '../services/__tests__/_helpers/build-backup-db';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-db-restore-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
// Per-suite import lock so parallel test files don't clobber each other.
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

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

describe('POST /api/portfolios — .db branch summary', () => {
  it('returns {entry, summary} on .db restore', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const sourcePath = buildQuovibeBackupDb({
      name: `Backup-${Date.now()}`,
      depositAccounts: 1,
      securities: 2,
      transactions: 4,
    });

    const r = await request(app)
      .post('/api/portfolios')
      .attach('file', sourcePath);

    expect(r.status, `got ${r.status} ${JSON.stringify(r.body)}`).toBe(201);
    expect(r.body.entry).toMatchObject({ source: 'import-quovibe-db' });
    expect(() => importSummarySchema.parse(r.body.summary)).not.toThrow();
    expect(r.body.summary).toEqual({ accounts: 1, securities: 2, transactions: 4 });
  });
});
