// packages/api/src/services/portfolio-db-pool.ts
import type BetterSqlite3 from 'better-sqlite3';
import { openDatabase, type OpenDatabaseResult } from '../db/open-db';
import { PORTFOLIO_POOL_MAX, resolvePortfolioPath } from '../config';
import type { PortfolioEntry } from '@quovibe/shared';

interface PooledHandle {
  handle: OpenDatabaseResult;
  refCount: number;
  lastReleased: number;
}

const pool = new Map<string, PooledHandle>();

/**
 * Resolves a portfolio id to a sidecar entry via the registry module.
 * Imported lazily to avoid a cycle between pool and registry.
 */
let resolveEntry: ((id: string) => PortfolioEntry | null) | null = null;
export function setResolveEntry(fn: (id: string) => PortfolioEntry | null): void {
  resolveEntry = fn;
}

/**
 * Post-open hook fired exactly once after the pool opens a handle on cache miss.
 * Used by auto-fetch wiring (ADR-015 §3.8a). Errors are caught and logged.
 */
type OpenedHook = (id: string, sqlite: BetterSqlite3.Database) => void;
let onOpened: OpenedHook | null = null;
export function setOnOpened(fn: OpenedHook): void { onOpened = fn; }

function evictIdleOverCap(): void {
  if (pool.size <= PORTFOLIO_POOL_MAX) return;
  const idle = [...pool.entries()]
    .filter(([, e]) => e.refCount === 0)
    .sort(([, a], [, b]) => a.lastReleased - b.lastReleased);
  for (const [id, e] of idle) {
    if (pool.size <= PORTFOLIO_POOL_MAX) break;
    try { e.handle.sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ok */ }
    try { e.handle.closeDb(); } catch { /* already closed */ }
    pool.delete(id);
  }
  if (pool.size > PORTFOLIO_POOL_MAX) {
    console.warn('[quovibe] portfolio pool over soft cap (all handles busy)', {
      size: pool.size,
      cap: PORTFOLIO_POOL_MAX,
    });
  }
}

/**
 * Acquire a pooled DB handle for the given portfolio id.
 * Opens lazily on cache miss (including applyBootstrap via openDatabase).
 * Caller MUST call releasePortfolioDb(id) exactly once per acquire.
 */
export function acquirePortfolioDb(id: string): OpenDatabaseResult {
  let entry = pool.get(id);
  let freshlyOpened = false;
  if (!entry) {
    if (!resolveEntry) throw new Error('portfolio-db-pool: resolveEntry not wired');
    const sidecarEntry = resolveEntry(id);
    if (!sidecarEntry) {
      const err = new Error('PORTFOLIO_NOT_FOUND');
      (err as Error & { code?: string }).code = 'PORTFOLIO_NOT_FOUND';
      throw err;
    }
    const filePath = resolvePortfolioPath(sidecarEntry);
    const handle = openDatabase(filePath);
    entry = { handle, refCount: 0, lastReleased: Date.now() };
    pool.set(id, entry);
    freshlyOpened = true;
  }
  entry.refCount++;
  evictIdleOverCap();
  if (freshlyOpened) {
    try { onOpened?.(id, entry.handle.sqlite); } catch (err) {
      console.warn('[quovibe] onOpened hook failed', { id, err: (err as Error).message });
    }
  }
  return entry.handle;
}

export function releasePortfolioDb(id: string): void {
  const entry = pool.get(id);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount === 0) {
    entry.lastReleased = Date.now();
    evictIdleOverCap();
  }
}

/**
 * Evict a specific portfolio from the pool (used by deletePortfolio and
 * renamePortfolio when the handle must be closed before file ops).
 */
export function evictPortfolioDb(id: string): void {
  const entry = pool.get(id);
  if (!entry) return;
  try { entry.handle.sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ok */ }
  try { entry.handle.closeDb(); } catch { /* already closed */ }
  pool.delete(id);
}

/** Debug / test helper. Never call from production code. */
export function _poolStateForTests(): { size: number; entries: Array<{ id: string; refCount: number }> } {
  return {
    size: pool.size,
    entries: [...pool.entries()].map(([id, e]) => ({ id, refCount: e.refCount })),
  };
}

/** Shutdown helper. */
export function closeAllPooledHandles(): void {
  for (const [id] of pool) evictPortfolioDb(id);
}
