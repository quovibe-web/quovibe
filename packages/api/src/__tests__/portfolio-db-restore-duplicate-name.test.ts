// Regression harness for BUG-173: POST /api/portfolios (multipart, .db restore)
// silently created a sibling registry entry with the same name as an existing
// portfolio. The fix runs `assertUniquePortfolioName` symmetrically with the
// PP-XML import path (BUG-92) and accepts an optional `name` form field as a
// rename override. Any regression that drops the guard, drops the override
// path, or re-orphans the multer temp file on a 409 fails one of these tests.
import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-db-restore-dup-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;
let createPortfolio: typeof import('../services/portfolio-manager').createPortfolio;
let exportPortfolio: typeof import('../services/portfolio-manager').exportPortfolio;
let app: Express;

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
  ({ createPortfolio, exportPortfolio } = await import('../services/portfolio-manager'));
  await import('../services/portfolio-registry');
  loadSettings();
  recoverFromInterruptedSwap();
  app = createApp();
});

async function freshPortfolio(name: string): Promise<{ id: string; backupBuf: Buffer }> {
  const { entry } = await createPortfolio({
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
    extraDeposits: [],
  });
  const out = await exportPortfolio(entry.id);
  const buf = fs.readFileSync(out.filePath);
  try { fs.unlinkSync(out.filePath); } catch { /* ok */ }
  return { id: entry.id, backupBuf: buf };
}

function tmpDirContents(): string[] {
  const dir = path.join(tmp, 'tmp');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

describe('POST /api/portfolios (.db restore) duplicate-name guard (BUG-173)', () => {
  it('source-name collision returns 409 DUPLICATE_NAME', async () => {
    const { backupBuf } = await freshPortfolio('Foxtrot');

    const before = tmpDirContents().length;
    const res = await request(app)
      .post('/api/portfolios')
      .attach('file', backupBuf, { filename: 'Foxtrot.db', contentType: 'application/x-sqlite3' });

    expect(res.status, `unexpected body: ${JSON.stringify(res.body)}`).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_NAME');
    // BUG-PRE14-04: 409 body MUST include the conflicting registry name
    // (not the filename stem) so the client can interpolate the actual label
    // the user sees in the switcher.
    expect(res.body.name).toBe('Foxtrot');
    // BUG-173 cleanup invariant: multer temp file MUST NOT orphan in data/tmp
    // when the guard rejects pre-atomicCopy.
    expect(tmpDirContents().length).toBe(before);
  });

  it('name override produces 201 with overridden registry name; inner meta keeps source', async () => {
    const { backupBuf } = await freshPortfolio('Golf');

    const res = await request(app)
      .post('/api/portfolios')
      .field('name', 'Golf Restored')
      .attach('file', backupBuf, { filename: 'Golf.db', contentType: 'application/x-sqlite3' });

    expect(res.status, `unexpected body: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.entry.name).toBe('Golf Restored');
    expect(res.body.entry.source).toBe('import-quovibe-db');

    const list = await request(app).get('/api/portfolios');
    const names = list.body.portfolios.map((p: { name: string }) => p.name).sort();
    expect(names).toContain('Golf');
    expect(names).toContain('Golf Restored');
  });

  it('override that itself collides returns 409 DUPLICATE_NAME', async () => {
    await freshPortfolio('Hotel');
    const { backupBuf } = await freshPortfolio('India');

    const res = await request(app)
      .post('/api/portfolios')
      .field('name', 'Hotel')
      .attach('file', backupBuf, { filename: 'India.db', contentType: 'application/x-sqlite3' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_NAME');
    expect(res.body.name).toBe('Hotel');
  });

  it('blank/whitespace override falls through to source name', async () => {
    const { backupBuf } = await freshPortfolio('Juliet');

    const res = await request(app)
      .post('/api/portfolios')
      .field('name', '   ')
      .attach('file', backupBuf, { filename: 'Juliet.db', contentType: 'application/x-sqlite3' });

    // Source vf_portfolio_meta name 'Juliet' collides with the existing entry,
    // so blank override must NOT bypass the guard.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_NAME');
    expect(res.body.name).toBe('Juliet');
  });
});
