// BUG-117: regression harness. POST /api/p/:pid/securities accepted any string
// as `isin` (no format check, no uniqueness). The fix:
//   1. shared schema: isinString refine — format `^[A-Z]{2}[A-Z0-9]{9}\d$` (400)
//   2. service: assertUniqueIsin — case-insensitive guard, throws
//      SecurityServiceError('DUPLICATE_ISIN') (409 at route)
//   3. update path: assertUniqueIsin with selfId so a self-rewrite is a no-op
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-sec-isin-'));
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

async function makePortfolio(app: ReturnType<typeof import('../create-app').createApp>, name: string): Promise<string> {
  const r = await request(app).post('/api/portfolios').send({
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(r.status).toBe(201);
  return r.body.entry.id;
}

describe('POST /securities ISIN guard (BUG-117)', () => {
  it('rejects malformed ISIN with 400', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-isin-1');

    const r = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'Junk', currency: 'EUR', isin: 'NOT_AN_ISIN',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
  });

  it('second create with same ISIN returns 409 DUPLICATE_ISIN', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-isin-2');

    const first = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'Apple', currency: 'EUR', isin: 'US0378331005',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const dup = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'Apple Clone', currency: 'EUR', isin: 'US0378331005',
    });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(dup.body.error).toBe('DUPLICATE_ISIN');
  });

  it('case-insensitive ISIN collision', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-isin-3');

    const first = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'Apple', currency: 'EUR', isin: 'US0378331005',
    });
    expect(first.status).toBe(201);

    const lower = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'Apple Lower', currency: 'EUR', isin: 'us0378331005',
    });
    expect(lower.status).toBe(409);
  });

  it('two securities without ISIN are allowed', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-isin-4');

    const a = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'No-ISIN A', currency: 'EUR',
    });
    const b = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'No-ISIN B', currency: 'EUR',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('PUT to existing ISIN collides 409; PUT to own ISIN is no-op 200', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-isin-5');

    const a = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'A', currency: 'EUR', isin: 'US0378331005',
    });
    const b = await request(app).post(`/api/p/${pid}/securities`).send({
      name: 'B', currency: 'EUR', isin: 'US5949181045',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const collide = await request(app)
      .put(`/api/p/${pid}/securities/${b.body.id}`)
      .send({ isin: 'US0378331005' });
    expect(collide.status, JSON.stringify(collide.body)).toBe(409);
    expect(collide.body.error).toBe('DUPLICATE_ISIN');

    const self = await request(app)
      .put(`/api/p/${pid}/securities/${a.body.id}`)
      .send({ isin: 'US0378331005' });
    expect(self.status).toBe(200);
  });

  it('uniqueness is per-portfolio: same ISIN in different portfolio is allowed', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pidA = await makePortfolio(app, 'P-isin-6a');
    const pidB = await makePortfolio(app, 'P-isin-6b');

    const a = await request(app).post(`/api/p/${pidA}/securities`).send({
      name: 'Apple', currency: 'EUR', isin: 'US0378331005',
    });
    const b = await request(app).post(`/api/p/${pidB}/securities`).send({
      name: 'Apple', currency: 'EUR', isin: 'US0378331005',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });
});
