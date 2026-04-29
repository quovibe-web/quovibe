// packages/api/src/__tests__/demo-singleton.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-ds-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));

  // Seed the minimal demo source — createPortfolio({source:'demo'}) reads this file.
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
  await import('../services/portfolio-registry');
});

describe('demo-singleton mutex', () => {
  it('10 parallel POST /api/portfolios { source:"demo" } produce exactly one entry', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post('/api/portfolios').send({ source: 'demo' })),
    );
    for (const r of responses) expect(r.status).toBe(201);
    const ids = responses.map((r) => r.body.entry.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(1);

    // Exactly one demo file exists
    const demoFiles = fs.readdirSync(tmp).filter((f) => f === 'portfolio-demo.db');
    expect(demoFiles.length).toBe(1);
  });
});
