// packages/api/src/__tests__/fx-rates-endpoint.test.ts
// Supertest integration tests for the fx-rates REST endpoints.
// Covers CRUD + ECB CSV bulk import, error codes, and multer hardening.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

vi.setConfig({ testTimeout: 20000 });

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-fxrates-'));
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
  expect(rP.status, `create portfolio: ${JSON.stringify(rP.body)}`).toBe(201);
  return rP.body.entry.id as string;
}

function makeApp(): ReturnType<typeof createApp> {
  loadSettings();
  recoverFromInterruptedSwap();
  return createApp();
}

// ─── GET pairs ────────────────────────────────────────────────────────────────

describe('GET /api/p/:pid/fx-rates', () => {
  it('returns empty pairs on a fresh portfolio', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-GET-1');
    const res = await request(app).get(`/api/p/${pid}/fx-rates`).expect(200);
    expect(res.body.pairs).toEqual([]);
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe('POST /api/p/:pid/fx-rates', () => {
  it('creates a MANUAL rate and returns 201 with source=MANUAL', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-POST-1');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' })
      .expect(201);
    expect(res.body.source).toBe('MANUAL');
    expect(res.body.from).toBe('EUR');
    expect(res.body.to).toBe('USD');
    expect(res.body.date).toBe('2026-01-01');
    expect(res.body.rate).toBe('1.10');
  });

  it('returns 400 INVALID_INPUT when body is missing required fields', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-POST-2');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR' })
      .expect(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 INVALID_INPUT when currency code has wrong length', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-POST-3');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EU', to: 'USD', date: '2026-01-01', rate: '1.10' })
      .expect(400);
    // Zod .length(3) fires first → INVALID_INPUT
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 SAME_CURRENCY when from === to (passes Zod, caught by service)', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-POST-4');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'EUR', date: '2026-01-01', rate: '1.0' })
      .expect(400);
    expect(res.body.error).toBe('SAME_CURRENCY');
  });

  it('returns 409 DUPLICATE_RATE on primary-key collision', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-POST-5');
    await request(app)
      .post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' })
      .expect(201);
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.20' })
      .expect(409);
    expect(res.body.error).toBe('DUPLICATE_RATE');
  });

  it('returns 400 INVALID_RATE when rate is zero', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-POST-6');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '0' })
      .expect(400);
    expect(res.body.error).toBe('INVALID_RATE');
  });
});

// ─── GET pair detail ──────────────────────────────────────────────────────────

describe('GET /api/p/:pid/fx-rates/:from/:to', () => {
  it('returns all rates for a pair in date DESC order', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-PAIR-1');
    await request(app).post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' }).expect(201);
    await request(app).post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-02', rate: '1.11' }).expect(201);
    const res = await request(app).get(`/api/p/${pid}/fx-rates/EUR/USD`).expect(200);
    expect(res.body).toHaveLength(2);
    // Ordered date DESC: 2026-01-02 first
    expect(res.body[0].date).toBe('2026-01-02');
    expect(res.body[1].date).toBe('2026-01-01');
  });

  it('returns 400 SAME_CURRENCY on same from/to in URL params', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-PAIR-2');
    const res = await request(app).get(`/api/p/${pid}/fx-rates/EUR/EUR`).expect(400);
    expect(res.body.error).toBe('SAME_CURRENCY');
  });

  it('returns empty array for unknown pair (not 404)', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-PAIR-3');
    const res = await request(app).get(`/api/p/${pid}/fx-rates/GBP/JPY`).expect(200);
    expect(res.body).toEqual([]);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /api/p/:pid/fx-rates/:from/:to/:date', () => {
  it('updates a MANUAL rate and returns 200 with new rate', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-PATCH-1');
    await request(app).post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' }).expect(201);
    const res = await request(app)
      .patch(`/api/p/${pid}/fx-rates/EUR/USD/2026-01-01`)
      .send({ rate: '1.25' })
      .expect(200);
    expect(res.body.rate).toBe('1.25');
    expect(res.body.from).toBe('EUR');
    expect(res.body.to).toBe('USD');
  });

  it('returns 404 RATE_NOT_FOUND_OR_NOT_MANUAL for non-existent row', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-PATCH-2');
    const res = await request(app)
      .patch(`/api/p/${pid}/fx-rates/EUR/USD/2026-01-01`)
      .send({ rate: '1.25' })
      .expect(404);
    expect(res.body.error).toBe('RATE_NOT_FOUND_OR_NOT_MANUAL');
  });

  it('returns 400 INVALID_INPUT when body is missing rate field', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-PATCH-3');
    const res = await request(app)
      .patch(`/api/p/${pid}/fx-rates/EUR/USD/2026-01-01`)
      .send({})
      .expect(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 INVALID_RATE when patching with a non-positive rate', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-PATCH-4');
    await request(app).post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' }).expect(201);
    const res = await request(app)
      .patch(`/api/p/${pid}/fx-rates/EUR/USD/2026-01-01`)
      .send({ rate: '-0.5' })
      .expect(400);
    expect(res.body.error).toBe('INVALID_RATE');
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/p/:pid/fx-rates/:from/:to/:date', () => {
  it('deletes a MANUAL rate and returns 204', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-DEL-1');
    await request(app).post(`/api/p/${pid}/fx-rates`)
      .send({ from: 'EUR', to: 'USD', date: '2026-01-01', rate: '1.10' }).expect(201);
    await request(app).delete(`/api/p/${pid}/fx-rates/EUR/USD/2026-01-01`).expect(204);
    // Verify gone
    const res = await request(app).get(`/api/p/${pid}/fx-rates/EUR/USD`).expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns 404 RATE_NOT_FOUND_OR_NOT_MANUAL for non-existent row', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-DEL-2');
    const res = await request(app)
      .delete(`/api/p/${pid}/fx-rates/EUR/USD/2026-01-01`)
      .expect(404);
    expect(res.body.error).toBe('RATE_NOT_FOUND_OR_NOT_MANUAL');
  });
});

// ─── POST /import-csv ─────────────────────────────────────────────────────────

describe('POST /api/p/:pid/fx-rates/import-csv', () => {
  it('imports ECB CSV and returns inserted + skipped counts', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-CSV-1');
    const csv = [
      'Date,USD,GBP,',
      '2026-01-01,1.10,0.86,',
      '2026-01-02,1.11,0.87,',
    ].join('\n');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates/import-csv`)
      .attach('file', Buffer.from(csv), { filename: 'eurofxref.csv', contentType: 'text/csv' })
      .expect(200);
    // 2 dates × 2 currencies = 4 rows
    expect(res.body.inserted).toBe(4);
    expect(res.body.skipped).toBe(0);
  });

  it('skips existing rows on re-import (INSERT OR IGNORE)', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-CSV-2');
    const csv = 'Date,USD,\n2026-01-01,1.10,\n';
    await request(app)
      .post(`/api/p/${pid}/fx-rates/import-csv`)
      .attach('file', Buffer.from(csv), { filename: 'eurofxref.csv', contentType: 'text/csv' })
      .expect(200);
    // Re-import same CSV
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates/import-csv`)
      .attach('file', Buffer.from(csv), { filename: 'eurofxref.csv', contentType: 'text/csv' })
      .expect(200);
    expect(res.body.inserted).toBe(0);
    expect(res.body.skipped).toBe(1);
  });

  it('returns 400 NO_FILE when no file is attached', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-CSV-3');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates/import-csv`)
      .expect(400);
    expect(res.body.error).toBe('NO_FILE');
  });

  it('returns 400 INVALID_FILE_FORMAT for non-.csv extension', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-CSV-4');
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates/import-csv`)
      .attach('file', Buffer.from('Date,USD\n2026-01-01,1.10'), {
        filename: 'rates.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    expect(res.body.error).toBe('INVALID_FILE_FORMAT');
  });

  it('returns 400 EMPTY_CSV for a CSV with only the header line', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-CSV-5');
    const csv = 'Date,USD,';
    const res = await request(app)
      .post(`/api/p/${pid}/fx-rates/import-csv`)
      .attach('file', Buffer.from(csv), { filename: 'empty.csv', contentType: 'text/csv' })
      .expect(400);
    expect(res.body.error).toBe('EMPTY_CSV');
  });

  it('imported rates appear in GET /fx-rates', async () => {
    const app = makeApp();
    const pid = await freshPortfolio(app, 'FX-CSV-6');
    const csv = 'Date,USD,\n2026-01-01,1.10,\n';
    await request(app)
      .post(`/api/p/${pid}/fx-rates/import-csv`)
      .attach('file', Buffer.from(csv), { filename: 'eurofxref.csv', contentType: 'text/csv' })
      .expect(200);
    const pairsRes = await request(app).get(`/api/p/${pid}/fx-rates`).expect(200);
    expect(pairsRes.body.pairs).toHaveLength(1);
    expect(pairsRes.body.pairs[0].from).toBe('EUR');
    expect(pairsRes.body.pairs[0].to).toBe('USD');
  });
});
