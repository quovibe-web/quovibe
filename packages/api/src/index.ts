import './bootstrap'; // MUST be first: copies schema.db before client.ts opens DB
import fs from 'fs';
import http from 'http';
import path from 'path';
import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { DB_PATH } from './config';
import { backupDb } from './db/backup';
import { openDatabase, type OpenDatabaseResult } from './db/open-db';
import { createApp } from './create-app';
import { PriceScheduler } from './workers/price-scheduler';
import { loadSettings, migrateLastImportFromDb } from './services/settings.service';
import { fetchAllExchangeRates, needsFxFetch } from './services/fx-fetcher.service';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const PRICE_CRON_SCHEDULE = process.env.PRICE_CRON_SCHEDULE ?? '0 18 * * 1-5'; // weekdays 18:00

// Mutable state managed by reloadApp()
let currentApp: Express;
let currentDbHandle: OpenDatabaseResult | null = null;
let currentScheduler: PriceScheduler | null = null;
let isReloading = false;
let activeRequests = 0;

function waitForDrain(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (activeRequests <= 0) return resolve();
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(() => {
      if (activeRequests <= 0 || Date.now() >= deadline) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

/**
 * Hot-reload: drain in-flight requests, optionally swap DB file, rebuild the app.
 * Defined at module scope so it captures module-level let variables by reference.
 */
async function reloadApp(tempDbPath?: string): Promise<void> {
  console.log('[quovibe] Hot reload: draining requests...');
  isReloading = true;

  // 1. Wait for in-flight requests to finish (max 5s)
  await waitForDrain(5000);
  if (activeRequests > 0) {
    console.warn(`[quovibe] Drain timeout: ${activeRequests} requests still active, proceeding.`);
  }

  // 2. Backup old DB BEFORE closing (VACUUM INTO requires open handle)
  if (tempDbPath && currentDbHandle) {
    backupDb(currentDbHandle.sqlite);
  }

  // 3. Stop old scheduler (terminates worker thread + its independent DB connection)
  if (currentScheduler) {
    await currentScheduler.stop();
  }

  // 4. Checkpoint WAL + close old DB
  if (currentDbHandle) {
    try { currentDbHandle.sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ok */ }
    try { currentDbHandle.closeDb(); } catch { /* already closed */ }
  }

  // 5. If tempDbPath provided (import flow): atomic file swap
  if (tempDbPath) {
    const swapPath = DB_PATH + '.swap';
    fs.copyFileSync(tempDbPath, swapPath);
    fs.renameSync(swapPath, DB_PATH);
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + ext); } catch { /* ok */ }
    }
  }

  // 6. Defensive cleanup of stale .swap from a previous crash
  try { fs.unlinkSync(DB_PATH + '.swap'); } catch { /* ok if not present */ }

  // 7. Open fresh DB + create new app
  const freshHandle = openDatabase(DB_PATH);
  currentDbHandle = freshHandle;
  loadSettings();

  const freshApp = createApp(freshHandle.db, freshHandle.sqlite);
  addStaticServing(freshApp);

  // 8. New scheduler
  const scheduler = new PriceScheduler(DB_PATH);
  currentScheduler = scheduler;
  freshApp.locals.priceScheduler = scheduler;
  scheduler.start(PRICE_CRON_SCHEDULE);

  // 9. Attach reloadApp (same module-scope function)
  freshApp.locals.reloadApp = reloadApp;

  currentApp = freshApp;
  isReloading = false;
  console.log('[quovibe] Hot reload complete.');
}

function buildFullApp(): Express {
  const dbHandle = openDatabase(DB_PATH);
  currentDbHandle = dbHandle;
  loadSettings();
  migrateLastImportFromDb(dbHandle.sqlite);

  const app = createApp(dbHandle.db, dbHandle.sqlite);

  // Start price scheduler
  const scheduler = new PriceScheduler(DB_PATH);
  currentScheduler = scheduler;
  app.locals.priceScheduler = scheduler;
  scheduler.start(PRICE_CRON_SCHEDULE);
  console.log(`[quovibe] Price scheduler started (${PRICE_CRON_SCHEDULE})`);

  // Attach module-scope reloadApp to app.locals
  app.locals.reloadApp = reloadApp;

  return app;
}

/**
 * Build a setup-mode app (DB not ready, only /api/import available).
 */
function buildSetupApp(): Express {
  const { importRouter } = require('./routes/import') as typeof import('./routes/import');
  const setupApp = express();
  setupApp.use(express.json());
  setupApp.use(cors());
  setupApp.use('/api/import', importRouter);

  // Attach module-scope reloadApp to app.locals
  setupApp.locals.reloadApp = reloadApp;

  // All other API calls return setup-required
  setupApp.use('/api', (_req, res) => {
    res.status(503).json({ error: 'SETUP_REQUIRED', setupUrl: '/import' });
  });

  return setupApp;
}

/**
 * Add production static file serving to an app.
 */
function addStaticServing(app: Express): void {
  if (process.env.NODE_ENV === 'production') {
    const staticPath = path.resolve(__dirname, '../../web/dist');
    app.use(express.static(staticPath));
    app.get('/{*path}', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }
}

function start() {
  try {
    currentApp = buildFullApp();

    // Auto-fetch FX rates if table is empty and portfolio has foreign currencies
    if (currentDbHandle && needsFxFetch(currentDbHandle.sqlite)) {
      console.log('[quovibe] FX rates table empty with foreign currencies — auto-fetching...');
      fetchAllExchangeRates(currentDbHandle.sqlite)
        .then(r => console.log(`[quovibe] Auto-fetched ${r.totalFetched} FX rates on startup`))
        .catch(err => console.warn('[quovibe] Startup FX auto-fetch failed:', (err as Error).message));
    }
  } catch {
    // DB not ready (missing or invalid schema) — start in setup mode
    console.warn('[quovibe] DB non pronto, avvio in setup mode (solo /api/import)');
    currentApp = buildSetupApp();
  }

  addStaticServing(currentApp);

  // Proxy server: delegates to currentApp, which can be swapped at runtime.
  // During hot reload, return 503 for non-import routes to prevent requests
  // from hitting the old app with a closed DB connection.
  const server = http.createServer((req, res) => {
    if (isReloading && !req.url?.startsWith('/api/import')) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
      res.end(JSON.stringify({ error: 'SERVER_RELOADING' }));
      return;
    }
    activeRequests++;
    res.on('close', () => { activeRequests--; });
    currentApp(req, res);
  });

  server.listen(PORT, () => {
    console.log(`[quovibe] Server listening on http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    console.error('[quovibe] Server failed to start:', err.message);
    process.exit(1);
  });

  const shutdown = async () => {
    console.log('[quovibe] Shutting down...');

    // 1. Stop accepting new requests (proxy returns 503 while isReloading)
    isReloading = true;
    server.close();

    // 2. Drain in-flight requests (max 5s), then stop worker
    await waitForDrain(5000);
    if (currentScheduler) await currentScheduler.stop();

    // 3. Checkpoint WAL + close DB
    if (currentDbHandle) {
      try { currentDbHandle.sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ok */ }
      try { currentDbHandle.closeDb(); } catch { /* ok */ }
    }

    process.exit(0);
  };

  // Best-effort checkpoint on unexpected crash before WAL recovery takes over
  const crashHandler = (err: unknown) => {
    console.error('[quovibe] Fatal error:', err);
    if (currentDbHandle) {
      try { currentDbHandle.sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ok */ }
      try { currentDbHandle.closeDb(); } catch { /* ok */ }
    }
    process.exit(1);
  };

  process.on('SIGTERM', () => { shutdown().catch(crashHandler); });
  process.on('SIGINT', () => { shutdown().catch(crashHandler); });
  process.on('uncaughtException', crashHandler);
  process.on('unhandledRejection', crashHandler);
}

start();
