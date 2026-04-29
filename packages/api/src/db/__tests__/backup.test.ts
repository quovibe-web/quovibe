// packages/api/src/db/__tests__/backup.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

// Env wiring BEFORE any deferred `await import(...)` resolves `../../config`.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-bk-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../apply-bootstrap').applyBootstrap;
let createPortfolio: typeof import('../../services/portfolio-manager').createPortfolio;
let acquirePortfolioDb: typeof import('../../services/portfolio-db-pool').acquirePortfolioDb;
let releasePortfolioDb: typeof import('../../services/portfolio-db-pool').releasePortfolioDb;
let closeAllPooledHandles: typeof import('../../services/portfolio-db-pool').closeAllPooledHandles;
let backupDb: typeof import('../backup').backupDb;
let resolvePortfolioPath: typeof import('../../config').resolvePortfolioPath;
let loadSettings: typeof import('../../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../../services/boot-recovery').recoverFromInterruptedSwap;
let getPortfolioEntry: typeof import('../../services/portfolio-registry').getPortfolioEntry;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../apply-bootstrap'));

  // Seed the demo source so createPortfolio() has a valid source file on disk
  // for the various init paths. (This file isn't exercised by fresh-source
  // creation but keeps the environment consistent with welcome-flow.test.ts.)
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo Portfolio')");
  } finally {
    db.close();
  }

  ({ createPortfolio } = await import('../../services/portfolio-manager'));
  ({ acquirePortfolioDb, releasePortfolioDb, closeAllPooledHandles } =
    await import('../../services/portfolio-db-pool'));
  ({ backupDb } = await import('../backup'));
  ({ resolvePortfolioPath } = await import('../../config'));
  ({ loadSettings } = await import('../../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../../services/boot-recovery'));
  ({ getPortfolioEntry } = await import('../../services/portfolio-registry'));
});

beforeEach(() => {
  closeAllPooledHandles();
  const sc = path.join(tmp, 'quovibe.settings.json');
  if (fs.existsSync(sc)) fs.unlinkSync(sc);
  for (const f of fs.readdirSync(tmp)) {
    if ((f.startsWith('portfolio-') && (f.endsWith('.db') || f.includes('.bak.')))) {
      try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ok */ }
    }
  }
  loadSettings();
  recoverFromInterruptedSwap();
});

describe('backupDb end-to-end via pool handle', () => {
  it('creates a valid .bak.{ts} file next to the portfolio DB', async () => {
    const { entry } = await createPortfolio({
      source: 'fresh', name: 'Backup-E2E',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
      extraDeposits: [],
    });
    const srcPath = resolvePortfolioPath(entry);
    expect(fs.existsSync(srcPath)).toBe(true);

    const { sqlite } = acquirePortfolioDb(entry.id);
    let backupPath: string;
    try {
      backupPath = backupDb(entry.id, sqlite);
    } finally {
      releasePortfolioDb(entry.id);
    }

    expect(backupPath).not.toBe('');
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(backupPath.startsWith(srcPath + '.bak.')).toBe(true);

    // Backup is a standalone, valid SQLite file; open it and read the meta row.
    const bak = new Database(backupPath, { readonly: true });
    try {
      const row = bak.prepare(
        "SELECT value FROM vf_portfolio_meta WHERE key = 'name'",
      ).get() as { value: string } | undefined;
      expect(row?.value).toBe('Backup-E2E');
    } finally {
      bak.close();
    }

    // VACUUM INTO produces a standalone file — no WAL/SHM sidecars.
    expect(fs.existsSync(backupPath + '-wal')).toBe(false);
    expect(fs.existsSync(backupPath + '-shm')).toBe(false);

    // Registry sanity — portfolio entry is still there after backup.
    expect(getPortfolioEntry(entry.id)).not.toBeNull();
  });

  it('rotates old backups so at most DB_BACKUP_MAX (default 3) coexist next to the DB', async () => {
    const { entry } = await createPortfolio({
      source: 'fresh', name: 'Backup-Rotate',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
      extraDeposits: [],
    });
    const srcPath = resolvePortfolioPath(entry);
    const dir = path.dirname(srcPath);
    const base = path.basename(srcPath);

    const { sqlite } = acquirePortfolioDb(entry.id);
    try {
      // Run 5 backups in sequence. `.bak.{Date.now()}` gives them unique
      // timestamps; sleep 2ms between to guarantee distinct ms (rotation
      // sorts lexicographically and would collapse ties into a smaller set).
      for (let i = 0; i < 5; i++) {   // native-ok
        backupDb(entry.id, sqlite);
        await new Promise(r => setTimeout(r, 2));    // native-ok
      }
    } finally {
      releasePortfolioDb(entry.id);
    }

    const backups = fs.readdirSync(dir).filter(f => f.startsWith(base + '.bak.'));
    expect(backups.length).toBeLessThanOrEqual(3);
    expect(backups.length).toBeGreaterThan(0);
  });
});
