// packages/api/src/routes/__tests__/events.test.ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'http';
import { eventsRouter, broadcast } from '../events';

function bootServer(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const app = express();
    app.use('/api/events', eventsRouter);
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function collectEvents(url: string, ms: number): Promise<string[]> {
  return new Promise((resolve) => {
    const req = http.get(url + '/api/events', (res) => {
      let buf = '';
      const chunks: string[] = [];
      res.on('data', (d) => {
        buf += d.toString();
        let i = buf.indexOf('\n\n');
        while (i !== -1) {
          chunks.push(buf.slice(0, i));
          buf = buf.slice(i + 2);
          i = buf.indexOf('\n\n');
        }
      });
      setTimeout(() => { req.destroy(); resolve(chunks); }, ms);
    });
  });
}

describe('SSE /api/events', () => {
  it('delivers broadcast events to a subscribed client', async () => {
    const { url, close } = await bootServer();
    try {
      const p = collectEvents(url, 200);
      // Broadcast on the next tick so the subscription is established
      setTimeout(() => {
        broadcast('portfolio.created', { id: 'abc' });
        broadcast('portfolio.renamed', { id: 'abc', name: 'X' });
      }, 50);
      const chunks = await p;
      const joined = chunks.join('\n');
      expect(joined).toContain('event: portfolio.created');
      expect(joined).toContain('"id":"abc"');
      expect(joined).toContain('event: portfolio.renamed');
    } finally {
      close();
    }
  });
});
