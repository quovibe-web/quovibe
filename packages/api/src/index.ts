// packages/api/src/index.ts
import './bootstrap';                   // ensureDataDir() only (Task 3c.12 rewrites bootstrap.ts)
import http from 'http';
import path from 'path';
import express from 'express';
import { createApp } from './create-app';
import { loadSettings } from './services/settings.service';
import { recoverFromInterruptedSwap } from './services/boot-recovery';
import { closeAllPooledHandles } from './services/portfolio-db-pool';
import { wireAutoFetchHook } from './services/auto-fetch';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

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
  loadSettings();
  recoverFromInterruptedSwap();
  wireAutoFetchHook();

  const app = createApp();
  addStaticServing(app);

  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`[quovibe] Server listening on http://localhost:${PORT}`);
  });

  const shutdown = (): void => {
    console.log('[quovibe] Shutting down...');
    server.close();
    closeAllPooledHandles();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const crashHandler = (err: unknown): void => {
    console.error('[quovibe] Fatal:', err);
    try { closeAllPooledHandles(); } catch { /* ok */ }
    process.exit(1);
  };
  process.on('uncaughtException', crashHandler);
  process.on('unhandledRejection', crashHandler);
}

start();
