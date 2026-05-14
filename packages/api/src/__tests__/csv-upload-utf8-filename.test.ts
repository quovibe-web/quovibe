// BUG-176 regression — CSV leg. busboy's default latin1 decode of
// Content-Disposition `filename=` mojibakes non-ASCII names; class fix is
// `defParamCharset: 'utf8'` on the multer config (mirrors routes/import.ts).
// Today's CSV pipeline only consumes `originalname` for `path.extname`, so
// the mojibake is functionally invisible — but the fix is still required to
// keep the bug class closed for any future surface that reflects it. This
// test mocks `saveTempFile` to capture the `originalName` argument and
// asserts the multer boundary handed it over with UTF-8 intact.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

vi.setConfig({ testTimeout: 20000 });

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-csv-utf8-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

const capturedNames: string[] = [];

vi.mock('../services/csv/csv-import.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/csv/csv-import.service')>();
  return {
    ...actual,
    saveTempFile: vi.fn((_buf: Buffer, originalName: string) => {
      capturedNames.push(originalName);
      // Throw a structured CsvImportError so the route exits cleanly with
      // 400 — irrelevant to the assertion below, which only inspects the
      // captured originalname.
      throw new actual.CsvImportError('INVALID_FILE_FORMAT', 'mock');
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

async function freshPortfolio(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const rP = await request(app).post('/api/portfolios').send({
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(rP.status).toBe(201);
  return rP.body.entry.id as string;
}

describe('POST /csv-import/trades/parse UTF-8 filename preservation (BUG-176)', () => {
  it('hands over UTF-8 originalname to saveTempFile (no mojibake)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-UTF8');
    capturedNames.length = 0;

    const csv = 'date,type,security,amount\n2026-01-02,BUY,ACME,100.00\n';

    await request(app)
      .post(`/api/p/${pid}/csv-import/trades/parse`)
      .attach('file', Buffer.from(csv), {
        filename: 'próbaID.csv',
        contentType: 'text/csv',
      });

    expect(
      capturedNames,
      'saveTempFile should have been called once with the UTF-8 filename',
    ).toEqual(['próbaID.csv']);
    expect(
      capturedNames.every((n) => !n.includes('prÃ³baID')),
      `mojibake regression — saw 'prÃ³baID' fragment in ${JSON.stringify(capturedNames)}`,
    ).toBe(true);
  });
});
