// packages/api/src/services/boot-recovery.ts
import fs from 'fs';
import path from 'path';
import {
  DATA_DIR, DEMO_SOURCE_PATH, SIDECAR_PATH, resolvePortfolioPath, isPortfolioFilename,
} from '../config';
import { atomicCopy, sweepStaleTmp, ensureDir } from '../lib/atomic-fs';
import { getSettings, updateSettings, loadSettings } from './settings.service';
import { rebuildRegistryFromDbs } from './portfolio-registry';
import type { PortfolioEntry, QuovibeSettings } from '@quovibe/shared';

const TMP_MAX_AGE_MS = 60 * 60 * 1000;                 // 1 hour

export interface OrphanPortfolioFile {
  path: string;
  id: string;
  sizeBytes: number;
}

/**
 * Remove `-wal` / `-shm` sidecar files in DATA_DIR that have no matching
 * `.db`. SQLite leaves these behind when the DB is unlinked mid-session
 * (kill -9, OS reboot during write, manual rm of only the .db file).
 * They are safe to delete when the parent `.db` does not exist: a future
 * open of `name.db` will recreate the WAL on demand.
 *
 * Returns the absolute paths that were removed for observability.
 */
export function sweepOrphanWalShm(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const removed: string[] = [];
  for (const f of fs.readdirSync(DATA_DIR)) {
    let dbName: string | null = null;
    if (f.endsWith('.db-wal')) dbName = f.slice(0, -'-wal'.length);
    else if (f.endsWith('.db-shm')) dbName = f.slice(0, -'-shm'.length);
    if (!dbName) continue;
    const dbPath = path.join(DATA_DIR, dbName);
    if (fs.existsSync(dbPath)) continue;
    const fullPath = path.join(DATA_DIR, f);
    try {
      fs.unlinkSync(fullPath);
      removed.push(fullPath);
    } catch (err) {
      console.warn('[quovibe] sweepOrphanWalShm: failed to unlink', { file: fullPath, err: (err as Error).message });
    }
  }
  if (removed.length > 0) {
    console.info(`[quovibe] sweepOrphanWalShm: removed ${removed.length} stale WAL/SHM sibling(s) with no matching .db.`);
  }
  return removed;
}

/**
 * Scan DATA_DIR for `portfolio-<uuid>.db` files not referenced by any
 * sidecar entry. Non-destructive: logs WARN, returns the list. Caller
 * must ensure DATA_DIR exists (boot path runs `ensureDir` first).
 */
export function sweepOrphanPortfolios(
  settings: QuovibeSettings = getSettings(),
): OrphanPortfolioFile[] {
  const knownIds = new Set(
    settings.portfolios.filter(p => p.kind === 'real').map(p => p.id),
  );

  const orphans: OrphanPortfolioFile[] = [];
  for (const f of fs.readdirSync(DATA_DIR)) {
    const id = isPortfolioFilename(f);
    if (!id) continue;
    if (knownIds.has(id)) continue;

    const fullPath = path.join(DATA_DIR, f);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(fullPath).size;
    } catch { /* file disappeared between readdir and stat */ }
    orphans.push({ path: fullPath, id, sizeBytes });
  }

  if (orphans.length > 0) {
    console.warn(
      `[quovibe] sweepOrphanPortfolios: ${orphans.length} orphan portfolio file(s) on disk; ` +
      `not referenced by the sidecar. Files were NOT deleted — review and remove manually if intentional.`,
      { orphans },
    );
  }
  return orphans;
}

/**
 * Run at start() before any DB opens. Reconciles the sidecar with the
 * filesystem:
 *   - missing real-portfolio file → drop the sidecar entry
 *   - missing demo file but entry exists → re-materialize from DEMO_SOURCE_PATH
 *   - malformed sidecar id → drop the entry
 *   - defaultPortfolioId points at a missing/invalid portfolio → fall back
 *   - data/tmp/ files older than 1h → delete
 *   - empty portfolios[] but portfolio-*.db files on disk → rebuild index
 */
export function recoverFromInterruptedSwap(): void {
  ensureDir(DATA_DIR);
  ensureDir(path.join(DATA_DIR, 'tmp'));
  loadSettings();
  const settings = getSettings();

  sweepStaleTmp(path.join(DATA_DIR, 'tmp'), TMP_MAX_AGE_MS);

  // Sidecar-less install with portfolio DBs present → rebuild the registry.
  if ((settings.portfolios ?? []).length === 0) {
    // `sidecarExisted=true && portfolios empty` means loadSettings either
    // hit a parse error (already logged WARN) or read a sidecar with an
    // empty list. The first case is data loss; the second is benign but
    // rare. Either way, recovering from filesystem after a non-empty
    // sidecar SHOULD have been parseable is the operator's signal to look
    // at the preceding warn.
    const sidecarExisted = fs.existsSync(SIDECAR_PATH);
    const rebuilt = rebuildRegistryFromDbs();
    if (rebuilt.length > 0) {
      console.warn(
        `[quovibe] Registry rebuilt from ${rebuilt.length} on-disk portfolio file(s). ` +
        (sidecarExisted
          ? `Sidecar at ${SIDECAR_PATH} was readable but contained no portfolios — likely corruption or a failed earlier write. Check preceding logs for the parse error.`
          : `Sidecar at ${SIDECAR_PATH} was missing — first run after fresh install or post-DATA_DIR move.`),
      );
      const firstReal = rebuilt.filter(p => p.kind === 'real')[0] ?? null;
      updateSettings({
        portfolios: rebuilt,
        app: {
          ...settings.app,
          defaultPortfolioId: firstReal?.id ?? null,
          initialized: !!firstReal,
        },
      });
    }
  }

  // Per-entry validation: resolve path from (id, kind), drop malformed,
  // re-materialize demo if missing.
  const current = getSettings();
  const defaultId = current.app.defaultPortfolioId;
  const keep: PortfolioEntry[] = [];
  for (const p of current.portfolios) {
    let filePath: string;
    try {
      filePath = resolvePortfolioPath(p);
    } catch {
      console.warn('[quovibe] dropping malformed sidecar entry', { id: p.id });
      continue;
    }
    if (fs.existsSync(filePath)) {
      keep.push(p);
      continue;
    }
    if (p.kind === 'demo') {
      if (fs.existsSync(DEMO_SOURCE_PATH)) {
        console.info('[quovibe] re-materializing demo', { filePath });
        atomicCopy(DEMO_SOURCE_PATH, filePath);
        keep.push(p);
      } else {
        console.warn('[quovibe] demo file missing AND DEMO_SOURCE_PATH missing; dropping entry', { id: p.id });
      }
    } else {
      console.warn('[quovibe] dropping sidecar entry for missing real file', { id: p.id });
    }
  }

  let nextDefault = defaultId;
  if (defaultId && !keep.find(p => p.id === defaultId)) {
    const fallback = keep
      .filter(p => p.kind === 'real')
      .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0];
    nextDefault = fallback?.id ?? null;
  }
  updateSettings({
    portfolios: keep,
    app: {
      ...current.app,
      defaultPortfolioId: nextDefault,
      initialized: keep.some(p => p.kind === 'real'),
    },
  });
}
