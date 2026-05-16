import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-sec-logo-'));
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

async function setup() {
  loadSettings();
  recoverFromInterruptedSwap();
  const app = createApp();

  const rP = await request(app).post('/api/portfolios').send({
    source: 'fresh',
    name: `Logo Test Portfolio ${Math.random().toString(36).slice(2)}`,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main',
    primaryDeposit: { name: 'Cash' },
  });
  expect(rP.status).toBe(201);
  const pid = rP.body.entry.id as string;

  const rS = await request(app)
    .post(`/api/p/${pid}/securities`)
    .send({ name: 'ACME Corp', currency: 'EUR' });
  expect(rS.status).toBe(201);
  const secId = rS.body.id as string;

  return { app, pid, secId };
}

describe('GET /api/p/:pid/securities/:id — logoUrl field', () => {
  it('returns logoUrl: null when no logo stored', async () => {
    const { app, pid, secId } = await setup();
    const res = await request(app).get(`/api/p/${pid}/securities/${secId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('logoUrl', null);
  });

  it('returns logoUrl with data-URI after logo is uploaded', async () => {
    const { app, pid, secId } = await setup();
    const fakeDataUri = 'data:image/png;base64,abc123';

    const rLogo = await request(app)
      .put(`/api/p/${pid}/securities/${secId}/logo`)
      .send({ logoUrl: fakeDataUri });
    expect(rLogo.status).toBe(200);

    const res = await request(app).get(`/api/p/${pid}/securities/${secId}`);
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe(fakeDataUri);
  });

  it('PUT /attributes does not wipe logo (regression: SecurityEditor save after auto-logo fetch)', async () => {
    const { app, pid, secId } = await setup();
    const fakeDataUri = 'data:image/png;base64,regression123';

    // Set logo via dedicated endpoint (as background fetch does after AddInstrumentDialog)
    const rLogo = await request(app)
      .put(`/api/p/${pid}/securities/${secId}/logo`)
      .send({ logoUrl: fakeDataUri });
    expect(rLogo.status).toBe(200);

    // Save non-logo attributes (as SecurityEditor handleSave does — logo is filtered out)
    const rAttrs = await request(app)
      .put(`/api/p/${pid}/securities/${secId}/attributes`)
      .send({ attributes: [] });
    expect(rAttrs.status).toBe(200);

    // Logo must survive the attributes PUT
    const res = await request(app).get(`/api/p/${pid}/securities/${secId}`);
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe(fakeDataUri);
  });
});
