// packages/api/src/services/portfolio-registry.ts
import fs from 'fs';
import path from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import Database from 'better-sqlite3';
import { DATA_DIR, isPortfolioFilename } from '../config';
import type { PortfolioEntry } from '@quovibe/shared';
import { getSettings, updateSettings } from './settings.service';
import { setResolveEntry } from './portfolio-db-pool';

/**
 * Read-only lookup: returns the sidecar entry for a given id, or null.
 * Callers (pool, middleware) use this to resolve id → filesystem path.
 */
export function getPortfolioEntry(id: string): PortfolioEntry | null {
  return getSettings().portfolios.find(p => p.id === id) ?? null;
}

export function listPortfolios(): PortfolioEntry[] {
  return getSettings().portfolios;
}

export function findDemoEntry(): PortfolioEntry | null {
  return getSettings().portfolios.find(p => p.kind === 'demo') ?? null;
}

export function upsertPortfolioEntry(entry: PortfolioEntry): void {
  const portfolios = getSettings().portfolios.slice();
  const i = portfolios.findIndex(p => p.id === entry.id);
  if (i >= 0) portfolios[i] = entry;
  else portfolios.push(entry);
  updateSettings({ portfolios });
}

export function removePortfolioEntry(id: string): void {
  const current = getSettings();
  const portfolios = current.portfolios.filter(p => p.id !== id);
  // If the deleted id was the default, fall back to lastOpenedAt DESC among remaining real.
  let newApp = current.app;
  if (current.app.defaultPortfolioId === id) {
    const fallback = portfolios
      .filter(p => p.kind === 'real')
      .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0];
    newApp = {
      ...current.app,
      defaultPortfolioId: fallback?.id ?? null,
      initialized: !!fallback,
    };
  }
  updateSettings({ portfolios, app: newApp });
}

/**
 * Rebuild the `portfolios[]` index by scanning data/ for portfolio-*.db files
 * and reading each one's `vf_portfolio_meta`. Called by boot-recovery when the
 * sidecar is missing `portfolios[]` or was deleted.
 *
 * Logs each auto-registration so operators can audit what was restored.
 */
export function rebuildRegistryFromDbs(): PortfolioEntry[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const entries: PortfolioEntry[] = [];
  for (const f of fs.readdirSync(DATA_DIR)) {
    // ADR-015: a bare `portfolio.db` is a pre-migration single-portfolio database.
    // The new layout uses `portfolio-{uuid}.db`; legacy files cannot be registered
    // because they have no id to key the sidecar entry against. Skip with a loud
    // warning so operators know to export + re-import via /welcome.
    if (f === 'portfolio.db') {
      console.warn('[quovibe] ignoring legacy portfolio.db (pre-ADR-015). Export to PP XML and re-import via /welcome. See docs/release-notes/2026-04-15-adr-015.md.');
      continue;
    }
    let id: string | null = null;
    let kind: 'real' | 'demo' | null = null;
    if (f === 'portfolio-demo.db') { id = 'demo-needs-id'; kind = 'demo'; }
    else {
      const extracted = isPortfolioFilename(f);
      if (extracted) { id = extracted; kind = 'real'; }
    }
    if (!id || !kind) continue;
    const filePath = path.join(DATA_DIR, f);
    try {
      const db: BetterSqlite3.Database = new Database(filePath, { readonly: true });
      try {
        const nameRow = db.prepare(
          "SELECT value FROM vf_portfolio_meta WHERE key = 'name'",
        ).get() as { value: string } | undefined;
        const createdRow = db.prepare(
          "SELECT value FROM vf_portfolio_meta WHERE key = 'createdAt'",
        ).get() as { value: string } | undefined;
        const sourceRow = db.prepare(
          "SELECT value FROM vf_portfolio_meta WHERE key = 'source'",
        ).get() as { value: string } | undefined;
        if (!nameRow?.value) continue;

        // Demo file has no sidecar-stable id — derive one on demand.
        const effectiveId = kind === 'demo'
          ? (findDemoEntry()?.id ?? crypto.randomUUID())
          : id;

        entries.push({
          id: effectiveId,
          name: nameRow.value,
          kind,
          source: (sourceRow?.value as PortfolioEntry['source']) ?? 'fresh',
          createdAt: createdRow?.value ?? new Date().toISOString(),
          lastOpenedAt: null,
        });
        console.info('[quovibe] rebuilt sidecar entry', { id: effectiveId, file: f });
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[quovibe] skipping unreadable portfolio file', { file: f, err: (err as Error).message });
    }
  }
  return entries;
}

// Wire the pool's id-resolver once at module load.
setResolveEntry(getPortfolioEntry);
