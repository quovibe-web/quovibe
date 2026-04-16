// packages/api/src/middleware/__tests__/portfolio-context.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import type { PortfolioEntry } from '@quovibe/shared';
import { applyBootstrap } from '../../db/apply-bootstrap';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-mw-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.PORTFOLIO_POOL_MAX = '5';

let setResolveEntry: (fn: (id: string) => PortfolioEntry | null) => void;
let closeAllPooledHandles: () => void;
let _poolStateForTests: () => { size: number; entries: Array<{ id: string; refCount: number }> };
let portfolioContext: express.RequestHandler;

const VALID = '11111111-1111-4111-8111-111111111111';
const ABSENT = '22222222-2222-4222-8222-222222222222';

function seedPortfolio(id: string): void {
  const p = path.join(tmp, `portfolio-${id}.db`);
  const db = new Database(p);
  applyBootstrap(db);
  db.close();
}

describe('portfolioContext middleware', () => {
  beforeAll(async () => {
    const pool = await import('../../services/portfolio-db-pool');
    setResolveEntry = pool.setResolveEntry;
    closeAllPooledHandles = pool.closeAllPooledHandles;
    _poolStateForTests = pool._poolStateForTests;
    const mw = await import('../portfolio-context');
    portfolioContext = mw.portfolioContext;
  });

  beforeEach(() => {
    seedPortfolio(VALID);
    setResolveEntry((id: string) => id === VALID
      ? { id, name: 't', kind: 'real', source: 'fresh', createdAt: '', lastOpenedAt: null }
      : null,
    );
  });
  afterEach(() => { closeAllPooledHandles(); });

  function buildApp(handler: express.RequestHandler): express.Express {
    const app = express();
    app.use('/api/p/:portfolioId', portfolioContext);
    app.get('/api/p/:portfolioId/ping', handler);
    return app;
  }

  it('400 on non-UUID id', async () => {
    const app = buildApp((_req, res) => { res.json({ ok: true }); });
    const r = await request(app).get('/api/p/not-a-uuid/ping');
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'INVALID_PORTFOLIO_ID' });
  });

  it('404 on unknown id', async () => {
    const app = buildApp((_req, res) => { res.json({ ok: true }); });
    const r = await request(app).get(`/api/p/${ABSENT}/ping`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'PORTFOLIO_NOT_FOUND' });
  });

  it('injects db + sqlite + portfolioId on valid id', async () => {
    let captured: Record<string, unknown> = {};
    const app = buildApp((req, res) => {
      captured = {
        hasDb: !!req.portfolioDb,
        hasSqlite: !!req.portfolioSqlite,
        id: req.portfolioId,
      };
      res.json(captured);
    });
    const r = await request(app).get(`/api/p/${VALID}/ping`);
    expect(r.status).toBe(200);
    expect(r.body.hasDb).toBe(true);
    expect(r.body.hasSqlite).toBe(true);
    expect(r.body.id).toBe(VALID);
  });

  it('releases refcount on finish', async () => {
    const app = buildApp((_req, res) => { res.json({ ok: true }); });
    await request(app).get(`/api/p/${VALID}/ping`);
    const state = _poolStateForTests();
    const e = state.entries.find((x: { id: string }) => x.id === VALID);
    expect(e?.refCount ?? 0).toBe(0);
  });

  it('releases refcount on premature client close', async () => {
    const app = buildApp((_req, res) => {
      // Simulate long work; abort the request.
      setTimeout(() => res.json({ ok: true }), 50);
    });
    const req1 = request(app).get(`/api/p/${VALID}/ping`);
    // Abort after 10ms
    setTimeout(() => req1.abort(), 10);
    try { await req1; } catch { /* aborted */ }
    // Give the 'close' listener a tick to fire
    await new Promise(r => setTimeout(r, 100));
    const state = _poolStateForTests();
    const e = state.entries.find((x: { id: string }) => x.id === VALID);
    expect(e?.refCount ?? 0).toBe(0);
  });
});
