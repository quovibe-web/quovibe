// packages/api/src/services/boot-recovery.ts
import fs from 'fs';
import path from 'path';
import {
  DATA_DIR, DEMO_SOURCE_PATH, resolvePortfolioPath,
} from '../config';
import { atomicCopy, sweepStaleTmp, ensureDir } from '../lib/atomic-fs';
import { getSettings, updateSettings, loadSettings } from './settings.service';
import { rebuildRegistryFromDbs } from './portfolio-registry';
import type { PortfolioEntry } from '@quovibe/shared';

const TMP_MAX_AGE_MS = 60 * 60 * 1000;                 // 1 hour

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
    const rebuilt = rebuildRegistryFromDbs();
    if (rebuilt.length > 0) {
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
