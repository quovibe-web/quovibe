import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ quiet: true });

/**
 * Find the monorepo root by walking up from cwd until we find pnpm-workspace.yaml.
 * Falls back to cwd if not found (Docker, standalone).
 */
function findMonorepoRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

const dataRoot = process.env.QUOVIBE_DATA_DIR
  ? path.resolve(process.env.QUOVIBE_DATA_DIR)
  : path.resolve(findMonorepoRoot(), 'data');

export const DATA_DIR = dataRoot;
export const SIDECAR_PATH = path.join(DATA_DIR, 'quovibe.settings.json');
export const DB_BACKUP_MAX = parseInt(process.env.DB_BACKUP_MAX ?? '3', 10);
export const PORTFOLIO_POOL_MAX = parseInt(process.env.PORTFOLIO_POOL_MAX ?? '5', 10);
export const IMPORT_MAX_MB = parseInt(process.env.IMPORT_MAX_MB ?? '50', 10);

// Dev fallback: scripts/seed-demo.ts writes to data/demo.db by default.
// Docker: set QUOVIBE_DEMO_SOURCE=/app/assets/demo.db via Dockerfile (ADR-015 §3.17).
export const DEMO_SOURCE_PATH =
  process.env.QUOVIBE_DEMO_SOURCE ?? path.join(DATA_DIR, 'demo.db');

/**
 * Strict RFC 4122 v4, lowercase. crypto.randomUUID() is the sole source of
 * portfolio ids, so narrower is better: rejects v1/v2/v3/v5, uppercase, and
 * shape-only patterns (e.g. 36 dashes) that wider regexes would accept.
 *
 * SINGLE SOURCE OF TRUTH — every portfolio-id validation site imports this.
 */
export const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PORTFOLIO_DB_PREFIX = 'portfolio-';
const PORTFOLIO_DB_SUFFIX = '.db';
const DEMO_DB_NAME = 'portfolio-demo.db';

/**
 * Filename helper used by the sidecar rebuild scan (§3.14).
 * Strips the `portfolio-` prefix and `.db` suffix, then validates the middle
 * against UUID_V4_RE. Returns the id on match, null otherwise.
 * Also accepts the literal `portfolio-demo.db` (→ null, special-cased by caller).
 */
export function isPortfolioFilename(f: string): string | null {
  if (f === DEMO_DB_NAME) return null;                      // demo handled separately
  if (!f.startsWith(PORTFOLIO_DB_PREFIX) || !f.endsWith(PORTFOLIO_DB_SUFFIX)) return null;
  const mid = f.slice(PORTFOLIO_DB_PREFIX.length, -PORTFOLIO_DB_SUFFIX.length);
  return UUID_V4_RE.test(mid) ? mid : null;
}

/**
 * Path resolver: derive the on-disk filename from (id, kind).
 * NEVER reads a `dbFile` field from the sidecar — path is a pure function of
 * validated fields, closing the hand-edit attack surface (§3.15).
 * Throws INVALID_PORTFOLIO_ID if id doesn't match UUID_V4_RE (kind='real').
 */
export function resolvePortfolioPath(entry: { id: string; kind: 'real' | 'demo' }): string {
  if (entry.kind === 'demo') return path.join(DATA_DIR, DEMO_DB_NAME);
  if (!UUID_V4_RE.test(entry.id)) {
    const err = new Error(`INVALID_PORTFOLIO_ID: ${entry.id}`);
    (err as Error & { code?: string }).code = 'INVALID_PORTFOLIO_ID';
    throw err;
  }
  const resolved = path.join(DATA_DIR, `${PORTFOLIO_DB_PREFIX}${entry.id}${PORTFOLIO_DB_SUFFIX}`);
  // Defense-in-depth: ensure the resolved path is inside DATA_DIR. `path.join` + validated id
  // already guarantees this, but the assertion makes the invariant explicit.
  const rel = path.relative(DATA_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`PATH_ESCAPE: ${resolved}`);
  }
  return resolved;
}

/**
 * @deprecated Retired in ADR-015 Phase 3c. Points at a fixed, legacy filename that
 * is never touched by the new code paths. Do not add new consumers.
 */
export const DB_PATH = path.join(DATA_DIR, 'portfolio.db');
/** @deprecated — see DB_PATH. */
export const SCHEMA_PATH = process.env.SCHEMA_PATH ?? path.join(DATA_DIR, 'schema.db');
