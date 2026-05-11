/**
 * cleanup-stale-fresh-portfolios.ts — One-shot maintenance script.
 *
 * Removes registry entries from `data/quovibe.settings.json` whose name
 * matches `^Fresh-\d{13}-[a-z0-9]+$` AND whose `lastOpenedAt` is null —
 * the auto-generated fixture portfolios accumulated by prior QA runs.
 * Also deletes the corresponding `data/portfolio-{uuid}.db` (and any
 * `-shm` / `-wal` SQLite sidecars) so the filesystem doesn't carry
 * orphan WAL files for entries that no longer exist in the registry.
 *
 * Per memory `feedback_sidecar_settings` the JSON file is the source
 * of truth for the registry. This script is intentionally NOT wired
 * into `applyBootstrap`: the runtime should not be deciding which
 * portfolios to delete (registry cleanup is a one-shot maintenance
 * task, not an app-startup behavior).
 *
 * Usage: pnpm tsx scripts/cleanup-stale-fresh-portfolios.ts
 *        pnpm tsx scripts/cleanup-stale-fresh-portfolios.ts --dry-run
 */
import * as fs from 'fs';
// Cross-package script imports are sanctioned (precedent: scripts/seed-demo.ts).
// The script is run via `pnpm tsx` outside Docker; in production these helpers
// are reachable through the api package's compiled output.
import { unlinkDbFile } from '../packages/api/src/lib/atomic-fs';
import {
  DATA_DIR,
  SIDECAR_PATH,
  resolvePortfolioPath,
} from '../packages/api/src/config';

// 13 = ms-since-epoch length per Date.now(); the fresh-portfolio name template
// in portfolio-manager.ts is `Fresh-${Date.now()}-${randomSuffix}`.
const FRESH_PORTFOLIO_NAME_PATTERN = /^Fresh-\d{13}-[a-z0-9]+$/;

interface PortfolioEntry {
  id: string;
  name: string;
  kind: 'real' | 'demo';
  source: string;
  createdAt: string;
  lastOpenedAt: string | null;
}

interface SettingsFile {
  schemaVersion?: number;
  version?: number;
  app?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  reportingPeriods?: unknown[];
  portfolios: PortfolioEntry[];
}

function isStale(entry: PortfolioEntry): boolean {
  return FRESH_PORTFOLIO_NAME_PATTERN.test(entry.name) && entry.lastOpenedAt === null;
}

function writeAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');

  if (!dryRun) {
    console.warn(
      '⚠️  Stop the API server before running — its in-memory settings cache will clobber this cleanup on next save.',
    );
  }

  console.log(`[cleanup] data dir:      ${DATA_DIR}`);
  console.log(`[cleanup] settings path: ${SIDECAR_PATH}`);

  if (!fs.existsSync(SIDECAR_PATH)) {
    console.error(`[cleanup] settings file not found: ${SIDECAR_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(SIDECAR_PATH, 'utf8');
  const settings = JSON.parse(raw) as SettingsFile;

  if (!Array.isArray(settings.portfolios)) {
    console.error('[cleanup] settings.portfolios is not an array — aborting.');
    process.exit(1);
  }

  const before = settings.portfolios.length;
  const stale = settings.portfolios.filter(isStale);
  const kept = settings.portfolios.filter((p) => !isStale(p));

  console.log(`[cleanup] registry entries before: ${before}`);
  console.log(`[cleanup] stale Fresh-* entries to remove: ${stale.length}`);
  console.log(`[cleanup] entries that will remain: ${kept.length}`);

  if (stale.length === 0) {
    console.log('[cleanup] nothing to do.');
    return;
  }

  if (dryRun) {
    console.log('[cleanup] --dry-run: no files modified. Sample of stale ids:');
    for (const p of stale.slice(0, 5)) {
      console.log(`  - ${p.name} (${p.id})`);
    }
    return;
  }

  for (const p of stale) {
    try {
      const dbPath = resolvePortfolioPath({ id: p.id, kind: 'real' });
      // unlinkDbFile silently handles ENOENT and removes -wal/-shm siblings.
      unlinkDbFile(dbPath);
      console.log(`[cleanup] removed portfolio-${p.id}.db (name=${p.name})`);
    } catch (err) {
      console.warn(`[cleanup] could not resolve path for ${p.id}: ${(err as Error).message}`);
    }
  }

  settings.portfolios = kept;
  writeAtomic(SIDECAR_PATH, JSON.stringify(settings, null, 2) + '\n');

  console.log(`[cleanup] registry rewritten: ${kept.length} entries`);
  console.log('[cleanup] done.');
}

main();
