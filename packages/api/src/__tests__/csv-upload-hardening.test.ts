// Regression harness for BUG-46: POST /csv-import/trades/parse returned 500 on
// non-CSV uploads instead of 400. The route now translates multer fileFilter /
// LIMIT_FILE_SIZE failures into structured CsvImportError codes that
// handleError maps to 400. Any regression that drops the wrapper or reverts the
// error codes will fail these tests.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

// Each test boots a fresh Express app + portfolio bootstrap. On slower CI
// runners that cold-start cost can edge past the 5s vitest default,
// triggering false-positive timeouts. 20s is generous but still bounded.
vi.setConfig({ testTimeout: 20000 });

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
  const rP = await request(app).post('/api/portfolios').send({
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
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

// BUG-97: re-parse an already-uploaded file with a new delimiter. Step 1's
// Delimiter dropdown used to persist state without telling the server, leaving
// the preview + sniff stale. The new /reparse route lets the client replace
// parseResult in place. These tests pin the wire contract.
describe('POST /csv-import/trades/reparse (BUG-97)', () => {
  it('re-splits an uploaded file with a new delimiter', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-REPARSE-1');

    // Semicolon-delimited CSV uploaded: on first parse the server's detector
    // lands on ';', but we then ask it to re-parse with ',' — which collapses
    // every row to a single column.
    const csv = 'date;type;security;amount\n2026-01-02;BUY;ACME;100.00\n';
    const up = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/parse`)
      .attach('file', Buffer.from(csv), { filename: 'semi.csv', contentType: 'text/csv' });
    expect(up.status).toBe(200);
    expect(up.body.detectedDelimiter).toBe(';');
    const tempFileId = up.body.tempFileId as string;

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/reparse`)
      .send({ tempFileId, delimiter: ',' });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.headers).toEqual(['date;type;security;amount']);
    expect(res.body.detectedDelimiter).toBe(',');
    expect(res.body.tempFileId).toBe(tempFileId);
  });

  it('returns 400 NO_FILE when tempFileId is missing', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-REPARSE-2');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/reparse`)
      .send({ delimiter: ',' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_FILE');
  });

  it('returns 410 TEMP_FILE_EXPIRED when the temp file is gone', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-REPARSE-3');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/reparse`)
      .send({ tempFileId: 'does-not-exist-uuid', delimiter: ',' });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('TEMP_FILE_EXPIRED');
  });

  it('returns 400 INVALID_INPUT on an unsupported delimiter (Zod guard)', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-REPARSE-4');

    const up = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/parse`)
      .attach('file', Buffer.from('a,b\n1,2\n'), { filename: 'ok.csv', contentType: 'text/csv' });
    expect(up.status).toBe(200);

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/reparse`)
      .send({ tempFileId: up.body.tempFileId, delimiter: 'xx' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });
});

// /trades/preview and /trades/execute used to accept `req.body` without any
// validation — malformed payloads would reach the service layer and risk a
// 500. These tests lock the Zod guards introduced alongside BUG-100 (see
// csv-import.ts tradePreviewSchema / tradeExecuteSchema).
describe('POST /csv-import/trades/preview + /execute Zod validation', () => {
  it('preview: 400 INVALID_INPUT when body is empty', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-PV-ZOD-1');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/preview`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('preview: 400 INVALID_INPUT when dateFormat is not one of csvDateFormats', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-PV-ZOD-2');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/preview`)
      .send({
        tempFileId: 'x',
        columnMapping: { date: 0 },
        dateFormat: 'nonsense',
        decimalSeparator: '.',
        thousandSeparator: '',
        targetSecuritiesAccountId: 'x',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('execute: 400 INVALID_INPUT when body is empty', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-EX-ZOD-1');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/execute`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('execute: 400 INVALID_INPUT when newSecurities lacks required fields', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await freshPortfolio(app, 'CSV-EX-ZOD-2');

    const res = await request(app)
      .post(`/api/p/${pid}/csv-import/trades/execute`)
      .send({
        tempFileId: 'x',
        config: {
          delimiter: ',',
          columnMapping: { date: 0 },
          dateFormat: 'yyyy-MM-dd',
          decimalSeparator: '.',
          thousandSeparator: '',
        },
        targetSecuritiesAccountId: 'x',
        securityMapping: {},
        newSecurities: [{ name: 'FooCorp' /* missing currency */ }],
        excludedRows: [],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });
});

// BUG-55 regression: in the CSV-import wizard, the wire field used to be
// `targetPortfolioId` and was typed by the client as the OUTER portfolio
// metadata UUID, but the service-layer `SELECT ... WHERE uuid = ? AND
// type = 'portfolio'` check treated it as an INNER `account.uuid`. These
// match only when a portfolio's inner DB has exactly one `type='portfolio'`
// row whose UUID coincidentally equals the metadata UUID. Multi-broker
// portfolios (Demo = Interactive Brokers + Scalable Capital, or any portfolio
// with N>=1 securities accounts whose UUIDs differ from the outer id) fail.
//
// Phase 1 of the BUG-54/55 plan renames the wire field
// `targetPortfolioId` → `targetSecuritiesAccountId` and the error code
// `INVALID_PORTFOLIO` → `INVALID_SECURITIES_ACCOUNT` so the names accurately
// describe what they represent. THIS TEST IS RED until Task 1.3 lands the
// rename; that is intentional TDD state. See
// docs/superpowers/plans/2026-04-19-portfolio-account-wiring.md Task 1.1.
describe('BUG-55: wire contract rejects outer metadata UUID on multi-broker portfolio', () => {
  it('returns 400 INVALID_SECURITIES_ACCOUNT when targetSecuritiesAccountId is the outer portfolio UUID of a multi-broker portfolio', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    // Lazy-import so module-top env (QUOVIBE_DATA_DIR / QUOVIBE_DEMO_SOURCE)
    // is in place before the helper resolves the api modules it depends on.
    const { seedMultiBrokerFixture } = await import('./_helpers/portfolio-fixtures');
    const { portfolioId, tempFileId } = await seedMultiBrokerFixture(app);

    // targetSecuritiesAccountId = outer metadata UUID → should fail because
    // none of the inner `type='portfolio'` rows seeded by the fixture share
    // that UUID. After the Task 1.3 rename the service must reject with the
    // new error code.
    const res = await request(app)
      .post(`/api/p/${portfolioId}/csv-import/trades/preview`)
      .send({
        tempFileId,
        delimiter: ',',
        columnMapping: { date: 0, type: 1, security: 2, amount: 3 },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.',
        thousandSeparator: '',
        targetSecuritiesAccountId: portfolioId, // BUG-55 vector
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe('INVALID_SECURITIES_ACCOUNT');
  });
});
