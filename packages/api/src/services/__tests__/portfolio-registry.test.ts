// packages/api/src/services/__tests__/portfolio-registry.test.ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import type { QuovibeSettings, PortfolioEntry } from '@quovibe/shared';

// Set env BEFORE importing any modules that read config.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-reg-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let rebuildRegistryFromDbs: () => PortfolioEntry[];
let loadSettings: () => void;
let getSettings: () => QuovibeSettings;
let applyBootstrap: (db: Database.Database) => void;

function writeSidecar(obj: unknown): void {
  fs.writeFileSync(path.join(tmp, 'quovibe.settings.json'), JSON.stringify(obj));
}

function seedBareLegacyDb(): void {
  // Legacy pre-ADR-015 layout: single `portfolio.db` with no id in the filename.
  // Bootstrap is applied so the file is a valid SQLite with vf_portfolio_meta,
  // but the filename itself cannot key a sidecar entry.
  const p = path.join(tmp, 'portfolio.db');
  const db = new Database(p);
  applyBootstrap(db);
  db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Legacy Name')");
  db.close();
}

describe('rebuildRegistryFromDbs', () => {
  beforeAll(async () => {
    const apply = await import('../../db/apply-bootstrap');
    applyBootstrap = apply.applyBootstrap;

    const registry = await import('../portfolio-registry');
    rebuildRegistryFromDbs = registry.rebuildRegistryFromDbs;
    const settings = await import('../settings.service');
    loadSettings = settings.loadSettings;
    getSettings = settings.getSettings;
  });

  beforeEach(() => {
    for (const f of fs.readdirSync(tmp)) {
      if (f.startsWith('portfolio') || f === 'quovibe.settings.json') {
        try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ok */ }
      }
    }
    writeSidecar({
      schemaVersion: 1,
      app: { initialized: false, defaultPortfolioId: null, autoFetchPricesOnFirstOpen: false },
      portfolios: [],
    });
    loadSettings();
  });

  it('warns once and skips registration when a bare legacy portfolio.db is present', () => {
    seedBareLegacyDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
    try {
      const entries = rebuildRegistryFromDbs();
      expect(entries).toHaveLength(0);
      expect(getSettings().portfolios).toHaveLength(0);

      const legacyCalls = warn.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('legacy portfolio.db'),
      );
      expect(legacyCalls).toHaveLength(1);
      expect(legacyCalls[0][0]).toMatch(/pre-ADR-015/);
      expect(legacyCalls[0][0]).toMatch(/\/welcome/);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when only a versioned portfolio-{uuid}.db is present', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const p = path.join(tmp, `portfolio-${id}.db`);
    const db = new Database(p);
    applyBootstrap(db);
    db.exec(`INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Real ${id}')`);
    db.close();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
    try {
      const entries = rebuildRegistryFromDbs();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(id);

      const legacyCalls = warn.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('legacy portfolio.db'),
      );
      expect(legacyCalls).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
