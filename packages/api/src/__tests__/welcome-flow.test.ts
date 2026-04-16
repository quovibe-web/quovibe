// packages/api/src/__tests__/welcome-flow.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

// Env wiring BEFORE any deferred `await import(...)` resolves `../config`.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-wf-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));

  // Seed a minimal demo source (required by createPortfolio({ source:'demo' })).
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo Portfolio')");
  } finally {
    db.close();
  }

  ({ createApp } = await import('../create-app'));
  ({ loadSettings } = await import('../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../services/boot-recovery'));
  // portfolio-registry wires the pool's resolveEntry on import
  await import('../services/portfolio-registry');
});

beforeEach(() => {
  const sc = path.join(tmp, 'quovibe.settings.json');
  if (fs.existsSync(sc)) fs.unlinkSync(sc);
  for (const f of fs.readdirSync(tmp)) {
    if (f.startsWith('portfolio-') && f.endsWith('.db')) fs.unlinkSync(path.join(tmp, f));
  }
  loadSettings();
  recoverFromInterruptedSwap();
});

describe('welcome flow end-to-end', () => {
  it('empty install → demo → real portfolio switch path', async () => {
    const app = createApp();

    // 1. Start empty
    let r = await request(app).get('/api/portfolios');
    expect(r.body).toEqual(expect.objectContaining({ initialized: false, portfolios: [] }));

    // 2. Create demo
    r = await request(app).post('/api/portfolios').send({ source: 'demo' });
    expect(r.status).toBe(201);
    const demoId = r.body.entry.id;

    // 3. Create fresh
    r = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Work' });
    expect(r.status).toBe(201);
    const realId = r.body.entry.id;

    // 4. List — now has both
    r = await request(app).get('/api/portfolios');
    expect(r.body.initialized).toBe(true);
    expect(r.body.defaultPortfolioId).toBe(realId);                 // first real wins
    const kinds = r.body.portfolios.map((p: { kind: string }) => p.kind).sort();
    expect(kinds).toEqual(['demo', 'real']);

    // 5. Rename real, rejected for demo
    r = await request(app).patch(`/api/portfolios/${realId}`).send({ name: 'Work Renamed' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Work Renamed');
    r = await request(app).patch(`/api/portfolios/${demoId}`).send({ name: 'Hacked Demo' });
    expect(r.status).toBe(403);

    // 6. Delete rejected for demo, allowed for real
    r = await request(app).delete(`/api/portfolios/${demoId}`);
    expect(r.status).toBe(403);
    r = await request(app).delete(`/api/portfolios/${realId}`);
    expect(r.status).toBe(204);

    // 7. After deletion, registry reflects it
    r = await request(app).get('/api/portfolios');
    const ids = r.body.portfolios.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(realId);
    expect(ids).toContain(demoId);
  });

  it('export/import produces a real portfolio with a new UUID', async () => {
    const app = createApp();

    const r1 = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'Source' });
    const sourceId = r1.body.entry.id;

    // Supertest must buffer the binary body into a Buffer — otherwise res.body
    // is left as `{}` and the subsequent .attach() chokes on a non-stream/non-Buffer value.
    const binaryParser = (res: NodeJS.ReadableStream, cb: (err: Error | null, data: Buffer) => void): void => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
      res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
    };
    const ex = await request(app)
      .get(`/api/portfolios/${sourceId}/export`)
      .buffer(true)
      .parse(binaryParser as never);
    expect(ex.status).toBe(200);
    expect(ex.headers['content-type']).toBe('application/x-sqlite3');
    const body = ex.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    // Upload as multipart
    const r2 = await request(app).post('/api/portfolios')
      .attach('file', body, { filename: 'x.db', contentType: 'application/x-sqlite3' });
    expect(r2.status).toBe(201);
    const importedId = r2.body.entry.id;
    expect(importedId).not.toBe(sourceId);
    expect(r2.body.entry.kind).toBe('real');
  });
});
