// Regression harness for BUG-46: POST /csv-import/trades/parse returned 500 on
// non-CSV uploads instead of 400. The route now translates multer fileFilter /
// LIMIT_FILE_SIZE failures into structured CsvImportError codes that
// handleError maps to 400. Any regression that drops the wrapper or reverts the
// error codes will fail these tests.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-csv-hard-'));
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

async function freshPortfolio(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const rP = await request(app).post('/api/portfolios').send({ source: 'fresh', name });
  expect(rP.status).toBe(201);
  return rP.body.entry.id as string;
}

describe('POST /csv-import/trades/parse boundary hardening (BUG-46)', () => {
  it('non-.csv extension returns 400 INVALID_FILE_FORMAT, not 500', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-HARD-1');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/parse`)
      .attach('file', Buffer.from('This is not a CSV\njust text'), {
        filename: 'bad.exe',
        contentType: 'application/octet-stream',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe('INVALID_FILE_FORMAT');
  });

  it('file over the 100 MB limit returns 400 FILE_TOO_LARGE, not 500', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-HARD-2');

    // 101 MB — one byte past the limit so multer fails fast without ballooning
    // the test's memory budget.
    const oversized = Buffer.alloc(101 * 1024 * 1024, 0x61); // native-ok

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/parse`)
      .attach('file', oversized, {
        filename: 'too-big.csv',
        contentType: 'text/csv',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe('FILE_TOO_LARGE');
  });

  it('missing file field returns 400 NO_FILE (regression guard)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-HARD-3');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/parse`)
      .field('delimiter', ',');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_FILE');
  });

  it('valid CSV returns 200 with parseResult (golden path)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-HARD-4');

    const csv = [
      'date,type,security,amount',
      '2026-01-02,BUY,ACME,100.00',
      '2026-01-03,SELL,ACME,120.50',
    ].join('\n');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/parse`)
      .attach('file', Buffer.from(csv), {
        filename: 'good.csv',
        contentType: 'text/csv',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.headers).toEqual(['date', 'type', 'security', 'amount']);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.detectedDelimiter).toBe(',');
    expect(typeof res.body.tempFileId).toBe('string');
  });
});
