// packages/api/src/routes/__tests__/chart-config.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

// Env wiring BEFORE any deferred `await import(...)` resolves `../../config`.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-cc-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../../create-app').createApp;
let loadSettings: typeof import('../../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../../services/boot-recovery').recoverFromInterruptedSwap;
let closeAllPooledHandles: typeof import('../../services/portfolio-db-pool').closeAllPooledHandles;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../../db/apply-bootstrap'));

  // Seed a minimal demo source (pattern established by welcome-flow.test.ts).
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo Portfolio')");
  } finally {
    db.close();
  }

  ({ createApp } = await import('../../create-app'));
  ({ loadSettings } = await import('../../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../../services/boot-recovery'));
  ({ closeAllPooledHandles } = await import('../../services/portfolio-db-pool'));
  // portfolio-registry wires the pool's resolveEntry on import
  await import('../../services/portfolio-registry');
});

beforeEach(() => {
  // Close any pooled handles from the previous test so we can unlink the .db files.
  closeAllPooledHandles();
  const sc = path.join(tmp, 'quovibe.settings.json');
  if (fs.existsSync(sc)) fs.unlinkSync(sc);
  for (const f of fs.readdirSync(tmp)) {
    if (f.startsWith('portfolio-') && f.endsWith('.db')) {
      try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ok */ }
    }
  }
  loadSettings();
  recoverFromInterruptedSwap();
});

async function createPortfolio(app: ReturnType<typeof createApp>): Promise<string> {
  const r = await request(app).post('/api/portfolios').send({
    source: 'fresh', name: 'CC Test',
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(r.status).toBe(201);
  return r.body.entry.id as string;
}

describe('chart-config route — scope-split invariant', () => {
  it('rejects aesthetic keys (lineThickness) with 400 INVALID_CHART_CONFIG', async () => {
    const app = createApp();
    const pid = await createPortfolio(app);

    const r = await request(app)
      .put(`/api/p/${pid}/chart-config/performance-main`)
      .send({ lineThickness: 2 });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe('INVALID_CHART_CONFIG');
  });

  it('accepts valid content payload and returns the stored row', async () => {
    const app = createApp();
    const pid = await createPortfolio(app);

    const body = {
      seriesRefs: [{ kind: 'security', id: 's-1' }],
      visibility: {},
      benchmarks: [],
    };

    const r = await request(app)
      .put(`/api/p/${pid}/chart-config/performance-main`)
      .send(body);

    expect(r.status).toBe(200);
    expect(r.body.chartId).toBe('performance-main');
    expect(r.body.config.seriesRefs).toEqual(body.seriesRefs);
    expect(r.body.config.visibility).toEqual({});
    expect(r.body.config.benchmarks).toEqual([]);
  });

  it('upsert → GET round-trips identically across repeated writes', async () => {
    const app = createApp();
    const pid = await createPortfolio(app);

    const body = {
      seriesRefs: [{ kind: 'security', id: 's-1' }],
      visibility: {},
      benchmarks: [],
    };

    const put1 = await request(app).put(`/api/p/${pid}/chart-config/performance-main`).send(body);
    expect(put1.status).toBe(200);
    const put2 = await request(app).put(`/api/p/${pid}/chart-config/performance-main`).send(body);
    expect(put2.status).toBe(200);

    const get = await request(app).get(`/api/p/${pid}/chart-config/performance-main`);
    expect(get.status).toBe(200);
    expect(get.body.config).toEqual(put1.body.config);
    expect(get.body.config).toEqual(put2.body.config);
  });
});
