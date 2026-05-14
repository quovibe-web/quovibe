import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { broadcastMutations } from '../broadcast-mutations';
import { _getBus, broadcast } from '../../routes/events';

const PID = '11111111-1111-4111-8111-111111111111';

type Captured = { event: string; data: unknown };

function captureBus(): Captured[] {
  const captured: Captured[] = [];
  const bus = _getBus();
  bus.on('event', (p: { event: string; data: unknown }) => captured.push(p));
  return captured;
}

function appWithPid(handler: RequestHandler): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/p/:portfolioId', (req, _res, next) => {
    req.portfolioId = req.params.portfolioId;
    next();
  });
  app.use('/api/p/:portfolioId', broadcastMutations);
  app.use('/api/p/:portfolioId', handler);
  return app;
}

function appWithoutPid(handler: RequestHandler): express.Express {
  const app = express();
  app.use(express.json());
  app.use(broadcastMutations);
  app.use('/x', handler);
  return app;
}

describe('broadcastMutations middleware', () => {
  let captured: Captured[];

  beforeEach(() => {
    _getBus().removeAllListeners('event');
    captured = captureBus();
  });

  afterEach(() => {
    _getBus().removeAllListeners('event');
  });

  it('broadcasts portfolio.mutated on a 200 POST', async () => {
    const app = appWithPid((_req, res) => res.status(200).json({ ok: true }));
    await request(app).post(`/api/p/${PID}/transactions`).send({});
    const events = captured.filter((c) => c.event === 'portfolio.mutated');
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({ id: PID });
  });

  it('broadcasts on 201 POST', async () => {
    const app = appWithPid((_req, res) => res.status(201).json({ ok: true }));
    await request(app).post(`/api/p/${PID}/x`).send({});
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(1);
  });

  it('broadcasts on 204 DELETE', async () => {
    const app = appWithPid((_req, res) => res.status(204).end());
    await request(app).delete(`/api/p/${PID}/x/abc`);
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(1);
  });

  it('broadcasts on PUT and PATCH', async () => {
    const app = appWithPid((_req, res) => res.status(200).json({ ok: true }));
    await request(app).put(`/api/p/${PID}/x`).send({});
    await request(app).patch(`/api/p/${PID}/x`).send({});
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(2);
  });

  it('does NOT broadcast on 400 (validation error)', async () => {
    const app = appWithPid((_req, res) => res.status(400).json({ error: 'INVALID_INPUT' }));
    await request(app).post(`/api/p/${PID}/x`).send({});
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(0);
  });

  it('does NOT broadcast on 404 (not found)', async () => {
    const app = appWithPid((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
    await request(app).delete(`/api/p/${PID}/x/zzz`);
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(0);
  });

  it('does NOT broadcast on 500 (server error)', async () => {
    const app = appWithPid((_req, res) => res.status(500).json({ error: 'BOOM' }));
    await request(app).post(`/api/p/${PID}/x`).send({});
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(0);
  });

  it('does NOT broadcast on GET (read-only)', async () => {
    const app = appWithPid((_req, res) => res.status(200).json({ ok: true }));
    await request(app).get(`/api/p/${PID}/x`);
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(0);
  });

  it('does NOT broadcast when req.portfolioId is missing (defensive)', async () => {
    const app = appWithoutPid((_req, res) => res.status(200).json({ ok: true }));
    await request(app).post('/x/y').send({});
    expect(captured.filter((c) => c.event === 'portfolio.mutated')).toHaveLength(0);
  });

  it('event payload uses req.portfolioId, not a query string or body field', async () => {
    const app = appWithPid((_req, res) => res.status(200).json({ ok: true }));
    const OTHER = '22222222-2222-4222-8222-222222222222';
    await request(app)
      .post(`/api/p/${PID}/x?portfolioId=${OTHER}`)
      .send({ portfolioId: OTHER });
    const events = captured.filter((c) => c.event === 'portfolio.mutated');
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({ id: PID });
  });

  it('upstream broadcast() unaffected (registry events still flow)', async () => {
    broadcast('portfolio.created', { id: PID });
    expect(captured.filter((c) => c.event === 'portfolio.created')).toHaveLength(1);
  });
});
