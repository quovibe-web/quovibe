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
