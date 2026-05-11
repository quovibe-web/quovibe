// packages/api/src/routes/events.ts
import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { EventEmitter } from 'events';

export const eventsRouter: RouterType = Router();

type EventName =
  | 'portfolio.created'
  | 'portfolio.renamed'
  | 'portfolio.deleted'
  | 'portfolio.mutated';

const bus = new EventEmitter();
bus.setMaxListeners(0);                          // many tabs = many listeners, unbounded

export function broadcast(event: EventName, data: unknown): void {
  bus.emit('event', { event, data });
}

// Test-only accessor. Production code MUST go through `broadcast()`.
export function _getBus(): EventEmitter {
  return bus;
}

const handler: RequestHandler = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');      // signal nginx-aware proxies to not buffer

  // Initial comment line flushes headers on some proxies.
  res.write(': ok\n\n');

  const listener = (payload: { event: EventName; data: unknown }): void => {
    res.write(`event: ${payload.event}\n`);
    res.write(`data: ${JSON.stringify(payload.data)}\n\n`);
  };
  bus.on('event', listener);

  // Keep-alive heartbeat (every 25s) — caps idle-connection reaper windows on proxies.
  const heartbeat = setInterval(() => { res.write(': ping\n\n'); }, 25_000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    bus.off('event', listener);
    try { res.end(); } catch { /* ok */ }
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
};

eventsRouter.get('/', handler);
