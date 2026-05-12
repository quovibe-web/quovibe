// packages/api/src/services/__tests__/boot-recovery.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import type { QuovibeSettings } from '@quovibe/shared';

// Set env BEFORE importing any modules that read config.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-br-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let recoverFromInterruptedSwap: () => void;
let sweepOrphanPortfolios: typeof import('../boot-recovery').sweepOrphanPortfolios;
let sweepOrphanWalShm: typeof import('../boot-recovery').sweepOrphanWalShm;
let loadSettings: () => void;
let getSettings: () => QuovibeSettings;
// applyBootstrap captured lazily so tests can seed both the demo source and
// individual portfolio files.
let applyBootstrap: (db: Database.Database) => void;

function writeSidecar(obj: unknown): void {
  fs.writeFileSync(path.join(tmp, 'quovibe.settings.json'), JSON.stringify(obj));
}

function seedPortfolioFile(id: string): void {
  const p = path.join(tmp, `portfolio-${id}.db`);
  const db = new Database(p);
  applyBootstrap(db);
  db.exec(`INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Restored ${id}')`);
  db.close();
}

describe('recoverFromInterruptedSwap', () => {
  beforeAll(async () => {
    const apply = await import('../../db/apply-bootstrap');
    applyBootstrap = apply.applyBootstrap;

    // Seed demo source BEFORE importing boot-recovery.
    const demoDb = new Database(process.env.QUOVIBE_DEMO_SOURCE as string);
    applyBootstrap(demoDb);
    demoDb.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo Portfolio')");
    demoDb.close();

    const br = await import('../boot-recovery');
    recoverFromInterruptedSwap = br.recoverFromInterruptedSwap;
    sweepOrphanPortfolios = br.sweepOrphanPortfolios;
    sweepOrphanWalShm = br.sweepOrphanWalShm;
    const settings = await import('../settings.service');
    loadSettings = settings.loadSettings;
    getSettings = settings.getSettings;
  });

  beforeEach(() => {
    for (const f of fs.readdirSync(tmp)) {
      if (f.startsWith('portfolio-') || f === 'quovibe.settings.json') {
        try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ok */ }
      }
    }
    loadSettings();
  });

  it('drops entries whose files are missing', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    writeSidecar({
      schemaVersion: 1,
      app: { initialized: true, defaultPortfolioId: id, autoFetchPricesOnFirstOpen: false },
      portfolios: [{ id, name: 'Ghost', kind: 'real', source: 'fresh', createdAt: '', lastOpenedAt: null }],
    });
    recoverFromInterruptedSwap();
    expect(getSettings().portfolios).toHaveLength(0);
    expect(getSettings().app.defaultPortfolioId).toBeNull();
    expect(getSettings().app.initialized).toBe(false);
  });

  it('re-materializes demo from DEMO_SOURCE_PATH', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    writeSidecar({
      schemaVersion: 1,
      app: { initialized: true, defaultPortfolioId: null, autoFetchPricesOnFirstOpen: false },
      portfolios: [{ id, name: 'Demo Portfolio', kind: 'demo', source: 'demo', createdAt: '', lastOpenedAt: null }],
    });
    recoverFromInterruptedSwap();
    expect(fs.existsSync(path.join(tmp, 'portfolio-demo.db'))).toBe(true);
  });

  it('rebuilds the registry from portfolio-*.db when sidecar is empty', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    seedPortfolioFile(id);
    writeSidecar({ schemaVersion: 1, app: {}, portfolios: [] });
    recoverFromInterruptedSwap();
    const entries = getSettings().portfolios;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id);
    expect(entries[0].name).toBe(`Restored ${id}`);
  });
});

describe('sweepOrphanPortfolios', () => {
  beforeEach(() => {
    for (const f of fs.readdirSync(tmp)) {
      if (f.startsWith('portfolio-') || f === 'quovibe.settings.json') {
        try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ok */ }
      }
    }
    loadSettings();
  });

  it('returns empty when DATA_DIR has no portfolio files', () => {
    writeSidecar({ schemaVersion: 1, app: {}, portfolios: [] });
    loadSettings();
    expect(sweepOrphanPortfolios()).toEqual([]);
  });

  it('returns empty when every on-disk portfolio file is in the sidecar', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    seedPortfolioFile(id);
    writeSidecar({
      schemaVersion: 1,
      app: { initialized: true, defaultPortfolioId: id, autoFetchPricesOnFirstOpen: false },
      portfolios: [{ id, name: 'Kept', kind: 'real', source: 'fresh', createdAt: '', lastOpenedAt: null }],
    });
    loadSettings();
    expect(sweepOrphanPortfolios()).toEqual([]);
  });

  it('flags portfolio-<uuid>.db files not referenced by the sidecar', () => {
    const kept = '55555555-5555-4555-8555-555555555555';
    const orphan = '66666666-6666-4666-8666-666666666666';
    seedPortfolioFile(kept);
    seedPortfolioFile(orphan);
    writeSidecar({
      schemaVersion: 1,
      app: { initialized: true, defaultPortfolioId: kept, autoFetchPricesOnFirstOpen: false },
      portfolios: [{ id: kept, name: 'Kept', kind: 'real', source: 'fresh', createdAt: '', lastOpenedAt: null }],
    });
    loadSettings();
    const found = sweepOrphanPortfolios();
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(orphan);
    expect(found[0].path).toBe(path.join(tmp, `portfolio-${orphan}.db`));
    expect(found[0].sizeBytes).toBeGreaterThan(0);
    // Non-destructive: orphan file must still exist on disk after the sweep.
    expect(fs.existsSync(found[0].path)).toBe(true);
  });

  it('ignores portfolio-demo.db (not a real-portfolio orphan candidate)', () => {
    fs.writeFileSync(path.join(tmp, 'portfolio-demo.db'), 'stub');
    writeSidecar({ schemaVersion: 1, app: {}, portfolios: [] });
    loadSettings();
    expect(sweepOrphanPortfolios()).toEqual([]);
  });

  it('ignores files that do not match portfolio-<uuid>.db', () => {
    fs.writeFileSync(path.join(tmp, 'portfolio-not-a-uuid.db'), 'stub');
    fs.writeFileSync(path.join(tmp, 'some-other-file.db'), 'stub');
    writeSidecar({ schemaVersion: 1, app: {}, portfolios: [] });
    loadSettings();
    expect(sweepOrphanPortfolios()).toEqual([]);
  });
});

describe('sweepOrphanWalShm', () => {
  beforeEach(() => {
    for (const f of fs.readdirSync(tmp)) {
      if (f.startsWith('portfolio-')) {
        try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ok */ }
      }
    }
  });

  it('removes -wal / -shm siblings whose .db is absent', () => {
    const orphanedDb = 'portfolio-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.db';
    fs.writeFileSync(path.join(tmp, orphanedDb + '-wal'), 'wal');
    fs.writeFileSync(path.join(tmp, orphanedDb + '-shm'), 'shm');

    const removed = sweepOrphanWalShm();
    expect(removed).toHaveLength(2);
    expect(fs.existsSync(path.join(tmp, orphanedDb + '-wal'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, orphanedDb + '-shm'))).toBe(false);
  });

  it('leaves -wal / -shm siblings whose .db exists', () => {
    const liveDb = 'portfolio-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.db';
    fs.writeFileSync(path.join(tmp, liveDb), 'db');
    fs.writeFileSync(path.join(tmp, liveDb + '-wal'), 'wal');
    fs.writeFileSync(path.join(tmp, liveDb + '-shm'), 'shm');

    expect(sweepOrphanWalShm()).toEqual([]);
    expect(fs.existsSync(path.join(tmp, liveDb + '-wal'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, liveDb + '-shm'))).toBe(true);
  });
});
