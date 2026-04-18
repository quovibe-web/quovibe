// packages/api/src/services/portfolio-manager.ts
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { DATA_DIR, DEMO_SOURCE_PATH, resolvePortfolioPath } from '../config';
import { applyBootstrap } from '../db/apply-bootstrap';
import { atomicCopy, ensureDir, unlinkDbFile } from '../lib/atomic-fs';
import { seedDefaultDashboard } from './dashboard-seed';
import {
  getPortfolioEntry,
  upsertPortfolioEntry,
  removePortfolioEntry,
  findDemoEntry,
  listPortfolios,
} from './portfolio-registry';
import { evictPortfolioDb, acquirePortfolioDb, releasePortfolioDb } from './portfolio-db-pool';
import { broadcast } from '../routes/events';
import { getSettings, updateSettings } from './settings.service';
import type { PortfolioEntry } from '@quovibe/shared';

export type CreatePortfolioSource = 'fresh' | 'demo' | 'import-pp-xml' | 'import-quovibe-db';

export interface CreatePortfolioInput {
  source: CreatePortfolioSource;
  name: string;                 // ignored for 'demo' (fixed to 'Demo Portfolio')
  uploadedDbPath?: string;      // required for 'import-quovibe-db'
  ppxmlTempDbPath?: string;     // required for 'import-pp-xml' (already populated by ppxml2db)
}

export interface CreatePortfolioResult {
  entry: PortfolioEntry;
  alreadyExisted?: boolean;     // true for idempotent demo re-creation
}

export class PortfolioManagerError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'PortfolioManagerError';
  }
}

// BUG-05: case-insensitive duplicate-name guard. The sidecar (listPortfolios) is
// the canonical list surface — the switcher reads from it — so the check runs
// there, not against vf_portfolio_meta. Demo entries are excluded because the
// demo name is a fixed constant ('Demo Portfolio') and demo creation is
// idempotent (alreadyExisted: true); a user with a real portfolio called
// "Demo Portfolio" must not collide with the demo, and vice versa. `selfId`
// lets renamePortfolio skip its own entry.
function assertUniquePortfolioName(name: string, selfId?: string): void {
  const target = name.trim().toLowerCase();
  if (!target) return; // empty name is rejected upstream
  const clash = listPortfolios().some(
    p => p.kind === 'real' && p.id !== selfId && p.name.trim().toLowerCase() === target,
  );
  if (clash) throw new PortfolioManagerError('DUPLICATE_NAME');
}

// --- in-process serialization for create ------------------------------------

// Demo-only singleton lock (§3.4d): concurrent "Try Demo" clicks collapse to
// one id. Non-demo sources (fresh / import-pp-xml / import-quovibe-db) each
// generate a fresh UUID before touching the filesystem, so they have no
// contention and must NOT be serialized — otherwise 3 parallel fresh creates
// would run strictly sequentially for no gain.
// quovibe:allow-module-state — process-wide demo-create concurrency lock; holds no portfolio data (ADR-016).
let demoCreateLock: Promise<CreatePortfolioResult> | null = null;

/**
 * Create a portfolio. Demo creation is serialized via a singleton lock so
 * concurrent "Try Demo" clicks return the same id (§3.4d). All other sources
 * run concurrently.
 */
export async function createPortfolio(input: CreatePortfolioInput): Promise<CreatePortfolioResult> {
  if (input.source !== 'demo') {
    return createPortfolioImpl(input);
  }
  const prev = demoCreateLock ?? Promise.resolve(null as unknown as CreatePortfolioResult);
  const next = prev
    .catch(() => null)
    .then(() => createPortfolioImpl(input));
  demoCreateLock = next;
  try {
    return await next;
  } finally {
    if (demoCreateLock === next) demoCreateLock = null;
  }
}

async function createPortfolioImpl(input: CreatePortfolioInput): Promise<CreatePortfolioResult> {
  ensureDir(DATA_DIR);

  if (input.source === 'demo') {
    const existing = findDemoEntry();
    if (existing) return { entry: existing, alreadyExisted: true };
    return createDemoImpl();
  }
  if (input.source === 'fresh') return createFreshImpl(input.name);
  if (input.source === 'import-pp-xml') {
    if (!input.ppxmlTempDbPath) {
      throw new PortfolioManagerError('INVALID_INPUT', 'ppxmlTempDbPath required');
    }
    return createImportedPpxmlImpl(input.name, input.ppxmlTempDbPath);
  }
  if (input.source === 'import-quovibe-db') {
    if (!input.uploadedDbPath) {
      throw new PortfolioManagerError('INVALID_INPUT', 'uploadedDbPath required');
    }
    return createImportedQuovibeDbImpl(input.uploadedDbPath);
  }
  throw new PortfolioManagerError('INVALID_SOURCE', input.source);
}

function createFreshImpl(name: string): CreatePortfolioResult {
  assertUniquePortfolioName(name);
  const id = crypto.randomUUID();
  const entry: PortfolioEntry = {
    id, name, kind: 'real', source: 'fresh',
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
  };
  const filePath = resolvePortfolioPath(entry);
  const db = new Database(filePath);
  try {
    applyBootstrap(db);
    seedMeta(db, { name, createdAt: entry.createdAt, source: 'fresh' });
    seedDefaultDashboard(db);
  } finally {
    db.close();
  }
  finalizeRegistry(entry);
  broadcast('portfolio.created', { id });
  return { entry };
}

function createDemoImpl(): CreatePortfolioResult {
  if (!fs.existsSync(DEMO_SOURCE_PATH)) {
    throw new PortfolioManagerError('DEMO_SOURCE_MISSING', DEMO_SOURCE_PATH);
  }
  const id = crypto.randomUUID();
  const entry: PortfolioEntry = {
    id, name: 'Demo Portfolio', kind: 'demo', source: 'demo',
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
  };
  const filePath = resolvePortfolioPath(entry);
  atomicCopy(DEMO_SOURCE_PATH, filePath);
  finalizeRegistry(entry);
  broadcast('portfolio.created', { id });
  return { entry };
}

function createImportedPpxmlImpl(name: string, ppxmlTempDbPath: string): CreatePortfolioResult {
  // BUG-05: the import paths deliberately bypass the duplicate-name guard.
  // Restoring a backup (quovibe-db) or re-importing a PP XML that matches a
  // real existing portfolio is a legitimate flow — see roundtrip.test.ts and
  // welcome-flow.test.ts. The guard only fires where the user types the name
  // interactively (createFreshImpl + renamePortfolio).
  const id = crypto.randomUUID();
  const entry: PortfolioEntry = {
    id, name, kind: 'real', source: 'import-pp-xml',
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
  };
  const filePath = resolvePortfolioPath(entry);
  // ppxml2db.py already populated the temp file. Move it into place and then
  // apply bootstrap.sql (idempotent additive vf_* tables + indexes).
  atomicCopy(ppxmlTempDbPath, filePath);
  const db = new Database(filePath);
  try {
    applyBootstrap(db);
    seedMeta(db, { name, createdAt: entry.createdAt, source: 'import-pp-xml' });
    seedDefaultDashboard(db);
  } finally {
    db.close();
  }
  finalizeRegistry(entry);
  broadcast('portfolio.created', { id });
  return { entry };
}

function createImportedQuovibeDbImpl(uploadedDbPath: string): CreatePortfolioResult {
  // Validation is caller's responsibility — route handler runs
  // validateQuovibeDbFile(uploadedDbPath) before invoking us. The result
  // includes the portfolio's original `name`, which we re-read here.
  const id = crypto.randomUUID();
  // We read vf_portfolio_meta from the file BEFORE moving it, to produce the entry.
  const readDb = new Database(uploadedDbPath, { readonly: true });
  let sourceName = '';
  let createdAt = new Date().toISOString();
  try {
    const n = readDb.prepare("SELECT value FROM vf_portfolio_meta WHERE key = 'name'").get() as
      { value: string } | undefined;
    sourceName = n?.value ?? 'Imported Portfolio';
    const c = readDb.prepare("SELECT value FROM vf_portfolio_meta WHERE key = 'createdAt'").get() as
      { value: string } | undefined;
    if (c?.value) createdAt = c.value;
  } finally {
    readDb.close();
  }
  // BUG-05: see createImportedPpxmlImpl — the import paths bypass the
  // duplicate-name guard so backup/restore roundtrips still work.
  const entry: PortfolioEntry = {
    id, name: sourceName, kind: 'real', source: 'import-quovibe-db',
    createdAt,
    lastOpenedAt: new Date().toISOString(),
  };
  const filePath = resolvePortfolioPath(entry);
  atomicCopy(uploadedDbPath, filePath);
  // Idempotent forward-compat fill-in (older exporter may lack newer vf_* tables).
  const db = new Database(filePath);
  try { applyBootstrap(db); } finally { db.close(); }
  finalizeRegistry(entry);
  broadcast('portfolio.created', { id });
  return { entry };
}

function seedMeta(
  db: Database.Database,
  values: { name: string; createdAt: string; source: CreatePortfolioSource },
): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES (?, ?)');
  stmt.run('name', values.name);
  stmt.run('createdAt', values.createdAt);
  stmt.run('source', values.source);
  stmt.run('schemaVersion', '1');
}

function finalizeRegistry(entry: PortfolioEntry): void {
  upsertPortfolioEntry(entry);
  const s = getSettings();
  const needsDefault = !s.app.defaultPortfolioId && entry.kind === 'real';
  const needsInit = !s.app.initialized && entry.kind !== 'demo';
  if (needsDefault || needsInit) {
    updateSettings({
      app: {
        ...s.app,
        defaultPortfolioId: needsDefault ? entry.id : s.app.defaultPortfolioId,
        initialized: needsInit ? true : s.app.initialized,
      },
    });
  }
}

// --- rename / delete --------------------------------------------------------

export function renamePortfolio(id: string, newName: string): PortfolioEntry {
  if (!newName.trim()) throw new PortfolioManagerError('EMPTY_NAME');
  const entry = getPortfolioEntry(id);
  if (!entry) throw new PortfolioManagerError('PORTFOLIO_NOT_FOUND');
  if (entry.kind === 'demo') throw new PortfolioManagerError('DEMO_PORTFOLIO_IMMUTABLE_METADATA');
  assertUniquePortfolioName(newName, id);

  const { sqlite } = acquirePortfolioDb(id);
  try {
    sqlite.prepare("UPDATE vf_portfolio_meta SET value = ? WHERE key = 'name'").run(newName);
  } finally {
    releasePortfolioDb(id);
  }
  const updated: PortfolioEntry = { ...entry, name: newName };
  upsertPortfolioEntry(updated);
  broadcast('portfolio.renamed', { id, name: newName });
  return updated;
}

export function deletePortfolio(id: string): void {
  const entry = getPortfolioEntry(id);
  if (!entry) throw new PortfolioManagerError('PORTFOLIO_NOT_FOUND');
  if (entry.kind === 'demo') throw new PortfolioManagerError('DEMO_PORTFOLIO_IMMUTABLE_METADATA');

  // Sidecar first (spec §3.4d ordering): even if unlink fails, the portfolio
  // disappears from the UI. On next boot, rebuildRegistryFromDbs re-registers
  // the orphan file if it still exists.
  removePortfolioEntry(id);
  evictPortfolioDb(id);
  const filePath = resolvePortfolioPath(entry);
  unlinkDbFile(filePath);
  broadcast('portfolio.deleted', { id });
}

// --- lastOpenedAt bump (used by switcher-pick) ------------------------------

export function touchPortfolio(id: string): void {
  const entry = getPortfolioEntry(id);
  if (!entry) throw new PortfolioManagerError('PORTFOLIO_NOT_FOUND');
  upsertPortfolioEntry({ ...entry, lastOpenedAt: new Date().toISOString() });
}

// --- export ----------------------------------------------------------------

export async function exportPortfolio(id: string): Promise<{ filePath: string; downloadName: string }> {
  const entry = getPortfolioEntry(id);
  if (!entry) throw new PortfolioManagerError('PORTFOLIO_NOT_FOUND');

  const { sqlite } = acquirePortfolioDb(id);
  const tmpDir = path.join(DATA_DIR, 'tmp');
  ensureDir(tmpDir);
  const tmpFile = path.join(tmpDir, `export-${crypto.randomUUID()}.db`);

  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    // better-sqlite3's backup() is Promise-returning and cooperative with concurrent readers.
    // See https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise
    await (sqlite as unknown as { backup(dest: string): Promise<unknown> }).backup(tmpFile);
  } finally {
    releasePortfolioDb(id);
  }

  const downloadName = sanitizeDownloadName(entry.name) + '-' + todayIso() + '.db';
  return { filePath: tmpFile, downloadName };
}

function sanitizeDownloadName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned || 'portfolio';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
