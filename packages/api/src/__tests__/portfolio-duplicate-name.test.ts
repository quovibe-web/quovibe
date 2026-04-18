// Regression harness for BUG-05: POST /api/portfolios accepted N portfolios
// with identical names, producing switcher duplicates indistinguishable to the
// user. The fix is a case-insensitive sidecar-scoped uniqueness guard in
// portfolio-manager.ts (see `assertUniquePortfolioName`). Any regression that
// removes the guard will cause this test to fail.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-portfolio-dup-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

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

describe('POST /portfolios duplicate-name guard (BUG-05)', () => {
  it('second fresh portfolio with the same name returns 409 DUPLICATE_NAME', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const first = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Alpha' });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Alpha' });
    expect(second.status, `unexpected body: ${JSON.stringify(second.body)}`).toBe(409);
    expect(second.body.error).toBe('DUPLICATE_NAME');
  });

  it('name collision is case-insensitive', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const first = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Bravo' });
    expect(first.status).toBe(201);

    const dup = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'BRAVO' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('DUPLICATE_NAME');

    const dupWithSpaces = await request(app).post('/api/portfolios').send({ source: 'fresh', name: '  bravo  ' });
    expect(dupWithSpaces.status).toBe(409);
  });

  it('rename-to-existing returns 409, rename-to-self is a no-op 200', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const a = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Charlie' });
    const b = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Delta' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // Rename b → Charlie should collide.
    const collide = await request(app)
      .patch(`/api/portfolios/${b.body.entry.id}`)
      .send({ name: 'Charlie' });
    expect(collide.status).toBe(409);
    expect(collide.body.error).toBe('DUPLICATE_NAME');

    // Renaming a portfolio to its own current name must succeed (no-op).
    const self = await request(app)
      .patch(`/api/portfolios/${a.body.entry.id}`)
      .send({ name: 'Charlie' });
    expect(self.status).toBe(200);
  });
});
