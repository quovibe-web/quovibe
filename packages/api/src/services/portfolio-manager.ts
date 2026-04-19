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
import { createAccount, listSecuritiesAccounts } from './accounts.service';
import type { PortfolioEntry } from '@quovibe/shared';

export type CreatePortfolioSource = 'fresh' | 'demo' | 'import-pp-xml' | 'import-quovibe-db';

/**
 * Server-internal payload for fresh-portfolio creation. Mirrors the wire-level
 * `FreshPortfolioInput` from `@quovibe/shared` (POST /api/portfolios body)
 * but is NOT a re-export — the two types are intentionally maintained
 * independently so service-internal callers (createFreshImpl, setupPortfolio)
 * stay decoupled from the HTTP contract.
 */
export interface FreshPortfolioInput {
  name: string;
  baseCurrency: string;
  securitiesAccountName: string;
  primaryDeposit: { name: string };
  extraDeposits: Array<{ name: string; currency: string }>;
}

/**
 * Server-internal superset of the shared `createPortfolioSchema` wire shape:
 * adds the `import-pp-xml` branch which flows through /api/import/xml and
 * never hits the registry endpoint. Discriminated union — narrow on `source`.
 */
export type CreatePortfolioInput =
  | ({ source: 'fresh' } & FreshPortfolioInput)
  | { source: 'demo' }
  | { source: 'import-pp-xml'; name: string; ppxmlTempDbPath: string }
  | { source: 'import-quovibe-db'; uploadedDbPath: string };

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
  if (input.source === 'fresh') return createFreshImpl(input);
  if (input.source === 'import-pp-xml') {
    return createImportedPpxmlImpl(input.name, input.ppxmlTempDbPath);
  }
  if (input.source === 'import-quovibe-db') {
    return createImportedQuovibeDbImpl(input.uploadedDbPath);
  }
  // Exhaustiveness — TS narrows `input` to never here.
  throw new PortfolioManagerError('INVALID_SOURCE');
}

function createFreshImpl(input: FreshPortfolioInput): CreatePortfolioResult {
  assertUniquePortfolioName(input.name);
  const id = crypto.randomUUID();
  const entry: PortfolioEntry = {
    id, name: input.name, kind: 'real', source: 'fresh',
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
  };
  const filePath = resolvePortfolioPath(entry);
  const db = new Database(filePath);
  try {
    applyBootstrap(db);
    seedMeta(db, { name: input.name, createdAt: entry.createdAt, source: 'fresh' });
    seedDefaultDashboard(db);
    seedFreshAccounts(db, input);
  } finally {
    db.close();
  }
  finalizeRegistry(entry);
  broadcast('portfolio.created', { id });
  return { entry };
}

/**
 * Seed the M3 default account layout for a freshly-created portfolio:
 *   1. primary deposit (currency = baseCurrency, no referenceAccount)
 *   2. zero or more extra deposits (each with its own currency)
 *   3. one securities account, referenceAccount → primary deposit's UUID
 *
 * All inserts run inside a single SQLite transaction so a partial failure
 * (e.g. DUPLICATE_NAME on an extra deposit) leaves the DB in its pre-call
 * state. Every insert routes through `accounts.service.createAccount` per
 * `.claude/rules/api.md` ("Every DB write MUST go through a service method").
 */
function seedFreshAccounts(
  db: Database.Database,
  input: FreshPortfolioInput,
): void {
  db.transaction(() => {
    // 1. Primary deposit (in base currency)
    const primaryId = crypto.randomUUID();
    createAccount(db, {
      id: primaryId,
      name: input.primaryDeposit.name,
      dbType: 'account',
      dbCurrency: input.baseCurrency,
      referenceAccountId: null,
    });

    // 2. Extra deposits
    for (const extra of input.extraDeposits) {
      createAccount(db, {
        id: crypto.randomUUID(),
        name: extra.name,
        dbType: 'account',
        dbCurrency: extra.currency,
        referenceAccountId: null,
      });
    }

    // 3. Securities account (references primary deposit)
    createAccount(db, {
      id: crypto.randomUUID(),
      name: input.securitiesAccountName,
      dbType: 'portfolio',
      dbCurrency: null,
      referenceAccountId: primaryId,
    });
  })();
}

/**
 * Initialize the M3 default account layout for an already-existing portfolio
 * whose inner DB has zero rows in `account` (the "legacy N=0" state). Used by
 * `POST /api/p/:pid/setup` (Phase 5 redirects users here when their portfolio
 * has not yet been wired).
 *
 * Guards:
 *   - PORTFOLIO_NOT_FOUND when the registry has no entry for `id` (defence in
 *     depth — middleware already 404s the route before we get here).
 *   - ALREADY_SETUP when the active securities-account list is non-empty.
 *
 * Inner errors from the seeding helper (notably AccountServiceError
 * 'DUPLICATE_NAME') propagate unchanged so the route layer can map them
 * symmetrically with `POST /api/portfolios` (both routes share the seeding
 * surface; both must surface DUPLICATE_NAME as 409).
 */
export function setupPortfolio(
  id: string,
  input: Omit<FreshPortfolioInput, 'name'>,
): void {
  const entry = getPortfolioEntry(id);
  if (!entry) throw new PortfolioManagerError('PORTFOLIO_NOT_FOUND');

  const { sqlite } = acquirePortfolioDb(id);
  try {
    const existing = listSecuritiesAccounts(sqlite);
    if (existing.length > 0) {
      throw new PortfolioManagerError('ALREADY_SETUP');
    }
    // Reuse the same transactional helper used by createFreshImpl. The `name`
    // field is required by the FreshPortfolioInput shape but is unused inside
    // the seeding helper — accounts only — so passing the registry name is
    // strictly type-satisfaction.
    seedFreshAccounts(sqlite, { name: entry.name, ...input });
  } finally {
    releasePortfolioDb(id);
  }
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
