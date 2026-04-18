// Regression harness for BUG-06: POST /api/accounts accepted N accounts with
// identical names in the same portfolio, producing confusing From/To dropdowns.
// The fix is a case-insensitive per-portfolio uniqueness guard in
// accounts.service.ts (see `createAccount` / `assertUniqueAccountName`). Any
// regression that removes the guard will cause this test to fail.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-account-dup-'));
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
  const r = await request(app).post('/api/portfolios').send({ source: 'fresh', name });
  expect(r.status).toBe(201);
  return r.body.entry.id;
}

describe('POST /accounts duplicate-name guard (BUG-06)', () => {
  it('second deposit account with the same name returns 409 DUPLICATE_NAME', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-dup-1');

    const first = await request(app).post(`/api/p/${pid}/accounts`).send({
      name: 'Conto Twist', type: 'DEPOSIT', currency: 'EUR',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const second = await request(app).post(`/api/p/${pid}/accounts`).send({
      name: 'Conto Twist', type: 'DEPOSIT', currency: 'EUR',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.error).toBe('DUPLICATE_NAME');
  });

  it('name collision is case-insensitive and trim-aware', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-dup-2');

    const first = await request(app).post(`/api/p/${pid}/accounts`).send({
      name: 'Main', type: 'DEPOSIT', currency: 'EUR',
    });
    expect(first.status).toBe(201);

    const upper = await request(app).post(`/api/p/${pid}/accounts`).send({
      name: 'MAIN', type: 'DEPOSIT', currency: 'EUR',
    });
    expect(upper.status).toBe(409);

    const padded = await request(app).post(`/api/p/${pid}/accounts`).send({
      name: '  main  ', type: 'DEPOSIT', currency: 'EUR',
    });
    expect(padded.status).toBe(409);
  });

  it('uniqueness is scoped per-portfolio: same name in a different portfolio is allowed', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pidA = await makePortfolio(app, 'P-dup-3a');
    const pidB = await makePortfolio(app, 'P-dup-3b');

    const a = await request(app).post(`/api/p/${pidA}/accounts`).send({
      name: 'Shared Name', type: 'DEPOSIT', currency: 'EUR',
    });
    const b = await request(app).post(`/api/p/${pidB}/accounts`).send({
      name: 'Shared Name', type: 'DEPOSIT', currency: 'EUR',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('rename-to-existing returns 409; rename-to-self is a no-op 200', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await makePortfolio(app, 'P-dup-4');

    const a = await request(app).post(`/api/p/${pid}/accounts`).send({
      name: 'Acct-A', type: 'DEPOSIT', currency: 'EUR',
    });
    const b = await request(app).post(`/api/p/${pid}/accounts`).send({
      name: 'Acct-B', type: 'DEPOSIT', currency: 'EUR',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const collide = await request(app)
      .put(`/api/p/${pid}/accounts/${b.body.id}`)
      .send({ name: 'Acct-A' });
    expect(collide.status, JSON.stringify(collide.body)).toBe(409);
    expect(collide.body.error).toBe('DUPLICATE_NAME');

    // Renaming a to 'Acct-A' (its own name) must pass.
    const self = await request(app)
      .put(`/api/p/${pid}/accounts/${a.body.id}`)
      .send({ name: 'Acct-A' });
    expect(self.status).toBe(200);
  });
});
