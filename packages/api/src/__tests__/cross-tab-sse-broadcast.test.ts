// End-to-end: real createApp + 2 SSE clients + real POST. Both clients
// must receive `event: portfolio.mutated` for the right portfolio id.

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import http from 'http';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-cross-tab-sse-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let seedFreshPortfolio: typeof import('./_helpers/portfolio-fixtures').seedFreshPortfolio;
let seedCashAccount: typeof import('./_helpers/portfolio-fixtures').seedCashAccount;

beforeAll(async () => {
  const { applyBootstrap } = await import('../db/apply-bootstrap');
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
  ({ seedFreshPortfolio, seedCashAccount } = await import('./_helpers/portfolio-fixtures'));
});

interface SseClient {
  chunks: string[];
  close: () => void;
  ready: Promise<void>;
}

function openSseClient(baseUrl: string): SseClient {
  const chunks: string[] = [];
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  const req = http.get(baseUrl + '/api/events', (res) => {
    let buf = '';
    res.on('data', (d) => {
      buf += d.toString();
      let i = buf.indexOf('\n\n');
      while (i !== -1) {
        const chunk = buf.slice(0, i);
        chunks.push(chunk);
        // First line of the SSE handler is `: ok` — use as readiness signal
        // so writes that race the subscription don't drop to the floor.
        if (chunk.startsWith(': ok')) resolveReady();
        buf = buf.slice(i + 2);
        i = buf.indexOf('\n\n');
      }
    });
  });
  return { chunks, close: () => req.destroy(), ready };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function bootApp(): Promise<{ url: string; close: () => Promise<void>; portfolioId: string }> {
  const { portfolioId, app } = await seedFreshPortfolio();
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
    portfolioId,
  };
}

describe('cross-tab SSE broadcast', () => {
  it('two SSE clients both receive portfolio.mutated for a real POST', async () => {
    const { url, close, portfolioId } = await bootApp();
    try {
      const accountUuid = await seedCashAccount(portfolioId);

      const tabA = openSseClient(url);
      const tabB = openSseClient(url);
      await Promise.all([tabA.ready, tabB.ready]);

      const post = await request(url)
        .post(`/api/p/${portfolioId}/transactions`)
        .send({
          date: '2026-01-01',
          type: 'DEPOSIT',
          amount: 100,
          currencyCode: 'EUR',
          accountId: accountUuid,
        });
      expect(post.status).toBe(201);

      await waitFor(
        () =>
          tabA.chunks.some((c) => c.includes('event: portfolio.mutated'))
          && tabB.chunks.some((c) => c.includes('event: portfolio.mutated')),
      );

      tabA.close();
      tabB.close();

      const tabAJoined = tabA.chunks.join('\n');
      const tabBJoined = tabB.chunks.join('\n');

      expect(tabAJoined).toContain('event: portfolio.mutated');
      expect(tabAJoined).toContain(`"id":"${portfolioId}"`);
      expect(tabBJoined).toContain('event: portfolio.mutated');
      expect(tabBJoined).toContain(`"id":"${portfolioId}"`);
    } finally {
      await close();
    }
  });

  it('a 4xx mutation produces NO portfolio.mutated event', async () => {
    const { url, close, portfolioId } = await bootApp();
    try {
      const tab = openSseClient(url);
      await tab.ready;

      // No accountId → Zod 400. portfolioContext passes (valid pid), so the
      // request reaches the route layer — middleware sees statusCode=400 and
      // skips the broadcast.
      const post = await request(url)
        .post(`/api/p/${portfolioId}/transactions`)
        .send({ date: '2026-01-01', type: 'DEPOSIT', amount: 100 });
      expect(post.status).toBe(400);

      // Race-window: short fixed pause to let any erroneous broadcast land.
      await new Promise((r) => setTimeout(r, 150));
      tab.close();

      const joined = tab.chunks.join('\n');
      expect(joined).not.toContain('event: portfolio.mutated');
    } finally {
      await close();
    }
  });
});
