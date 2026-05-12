// packages/api/src/index.ts
import './bootstrap';                   // ensureDataDir() only (Task 3c.12 rewrites bootstrap.ts)
import http from 'http';
import path from 'path';
import express from 'express';
import { createApp } from './create-app';
import { loadSettings } from './services/settings.service';
import { recoverFromInterruptedSwap, sweepOrphanPortfolios, sweepOrphanWalShm } from './services/boot-recovery';
import { closeAllPooledHandles } from './services/portfolio-db-pool';
import { wireAutoFetchHook } from './services/auto-fetch';
import { wireFxScheduler } from './services/fx-scheduler.service';
import { acquireInstanceLock, releaseInstanceLock, InstanceLockHeldError } from './services/instance-lock';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const SHUTDOWN_DRAIN_MS = parseInt(process.env.QUOVIBE_SHUTDOWN_DRAIN_MS ?? '10000', 10);

function addStaticServing(app: express.Express): void {
  if (process.env.NODE_ENV === 'production') {
    const staticPath = path.resolve(__dirname, '../../web/dist');
    app.use(express.static(staticPath));
    app.get('/{*path}', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }
}

function start(): void {
  try {
    acquireInstanceLock();
  } catch (err) {
    if (err instanceof InstanceLockHeldError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  loadSettings();
  recoverFromInterruptedSwap();
  // One-shot boot-time signals; not part of per-request recovery. Live
  // here (not in recoverFromInterruptedSwap) so test fixtures that rebuild
  // an Express app per case don't pay the directory walks every time.
  sweepOrphanWalShm();
  sweepOrphanPortfolios();
  wireAutoFetchHook();
  wireFxScheduler();

  const app = createApp();
  addStaticServing(app);

  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`[quovibe] Server listening on http://localhost:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[quovibe] Shutting down (drain timeout ${SHUTDOWN_DRAIN_MS}ms)...`);

    const forceExitTimer = setTimeout(() => {
      console.warn('[quovibe] Drain timeout exceeded — forcing exit');
      try { closeAllPooledHandles(); } catch { /* ok */ }
      try { releaseInstanceLock(); } catch { /* ok */ }
      process.exit(1);
    }, SHUTDOWN_DRAIN_MS);
    forceExitTimer.unref();

    server.close((err) => {
      clearTimeout(forceExitTimer);
      if (err) console.error('[quovibe] server.close error:', err);
      try { closeAllPooledHandles(); } catch (e) { console.error('[quovibe] pool close error:', e); }
      try { releaseInstanceLock(); } catch (e) { console.error('[quovibe] lock release error:', e); }
      process.exit(err ? 1 : 0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const crashHandler = (err: unknown): void => {
    console.error('[quovibe] Fatal:', err);
    try { closeAllPooledHandles(); } catch { /* ok */ }
    try { releaseInstanceLock(); } catch { /* ok */ }
    process.exit(1);
  };
  process.on('uncaughtException', crashHandler);
  process.on('unhandledRejection', crashHandler);
}

start();
