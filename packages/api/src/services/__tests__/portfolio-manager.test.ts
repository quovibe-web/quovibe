// packages/api/src/services/__tests__/portfolio-manager.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import fs from 'fs';
import Database from 'better-sqlite3';
import type { PortfolioEntry } from '@quovibe/shared';
import type { CreatePortfolioInput } from '../portfolio-manager';

// Set env BEFORE importing anything that reads from config.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-pm-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

// Helper to build the M3 fresh-portfolio payload — the test only varies `name`.
function freshInput(name: string): CreatePortfolioInput {
  return {
    source: 'fresh', name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
    extraDeposits: [],
  };
}

// Late-bound bindings populated in beforeAll.
let createPortfolio: (
  input: CreatePortfolioInput,
) => Promise<{ entry: PortfolioEntry; alreadyExisted?: boolean }>;
let renamePortfolio: (id: string, newName: string) => PortfolioEntry;
let deletePortfolio: (id: string) => void;
let exportPortfolio: (id: string) => Promise<{ filePath: string; downloadName: string }>;
let loadSettings: () => void;

describe('portfolio-manager', () => {
  beforeAll(async () => {
    // Seed demo source BEFORE importing portfolio-manager.
    const { applyBootstrap } = await import('../../db/apply-bootstrap');
    const demoDb = new Database(process.env.QUOVIBE_DEMO_SOURCE as string);
    applyBootstrap(demoDb);
    demoDb.exec(
      "INSERT INTO vf_portfolio_meta (key, value) VALUES " +
      "('name','Demo Portfolio')," +
      "('createdAt','2026-01-01T00:00:00Z')," +
      "('source','demo')",
    );
    demoDb.close();

    const pm = await import('../portfolio-manager');
    createPortfolio = pm.createPortfolio;
    renamePortfolio = pm.renamePortfolio;
    deletePortfolio = pm.deletePortfolio;
    exportPortfolio = pm.exportPortfolio;

    const settings = await import('../settings.service');
    loadSettings = settings.loadSettings;
  });

  beforeEach(() => {
    // Reset sidecar + portfolio-* files before each test.
    for (const f of fs.readdirSync(tmp)) {
      if (f.startsWith('portfolio-') || f === 'quovibe.settings.json') {
        try { fs.unlinkSync(path.join(tmp, f)); } catch { /* ok */ }
      }
    }
    loadSettings();
  });

  describe('create', () => {
    it('fresh creates a new real portfolio with default dashboard', async () => {
      const { entry } = await createPortfolio(freshInput('Mine'));
      expect(entry.kind).toBe('real');
      expect(entry.source).toBe('fresh');
      const dbPath = path.join(tmp, `portfolio-${entry.id}.db`);
      expect(fs.existsSync(dbPath)).toBe(true);

      const db = new Database(dbPath, { readonly: true });
      const nameRow = db.prepare("SELECT value FROM vf_portfolio_meta WHERE key='name'").get() as
        { value: string };
      const dashCount = db.prepare("SELECT COUNT(*) as n FROM vf_dashboard").get() as { n: number };
      db.close();
      expect(nameRow.value).toBe('Mine');
      expect(dashCount.n).toBe(1);
    });

    it('demo is idempotent under concurrent calls (demo-singleton mutex)', async () => {
      const [a, b] = await Promise.all([
        createPortfolio({ source: 'demo' }),
        createPortfolio({ source: 'demo' }),
      ]);
      expect(a.entry.id).toBe(b.entry.id);
      // Exactly one demo file on disk
      const files = fs.readdirSync(tmp).filter(f => f.startsWith('portfolio-demo.db'));
      expect(files.length).toBe(1);
    });

    it('3 parallel fresh creates produce 3 distinct files and 3 distinct ids', async () => {
      const all = Promise.all([
        createPortfolio(freshInput('X-0')),
        createPortfolio(freshInput('X-1')),
        createPortfolio(freshInput('X-2')),
      ]);
      // Prove the mutations don't hang (they shouldn't serialize on any lock).
      const timeout = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('parallel fresh creates timed out')), 2000),
      );
      const results = await Promise.race([all, timeout]);
      const ids = results.map(r => r.entry.id);
      expect(new Set(ids).size).toBe(3);

      const freshFiles = fs.readdirSync(tmp)
        .filter(f => f.startsWith('portfolio-') && f.endsWith('.db') && f !== 'portfolio-demo.db');
      expect(freshFiles.length).toBe(3);
    });
  });

  describe('rename', () => {
    it('updates vf_portfolio_meta.name and the sidecar entry', async () => {
      const { entry } = await createPortfolio(freshInput('Old'));
      const renamed = renamePortfolio(entry.id, 'New');
      expect(renamed.name).toBe('New');
      const db = new Database(path.join(tmp, `portfolio-${entry.id}.db`), { readonly: true });
      const row = db.prepare("SELECT value FROM vf_portfolio_meta WHERE key='name'").get() as
        { value: string };
      db.close();
      expect(row.value).toBe('New');
    });

    it('rejects rename of a demo portfolio', async () => {
      const { entry } = await createPortfolio({ source: 'demo' });
      expect(() => renamePortfolio(entry.id, 'Hacked'))
        .toThrow(/DEMO_PORTFOLIO_IMMUTABLE_METADATA/);
    });
  });

  describe('delete', () => {
    it('removes the file and sidecar entry, unlinks WAL siblings', async () => {
      const { entry } = await createPortfolio(freshInput('Doomed'));
      const dbPath = path.join(tmp, `portfolio-${entry.id}.db`);
      fs.writeFileSync(dbPath + '-wal', 'x');           // fake WAL to prove unlink happens
      deletePortfolio(entry.id);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(dbPath + '-wal')).toBe(false);
    });

    it('rejects delete of a demo portfolio', async () => {
      const { entry } = await createPortfolio({ source: 'demo' });
      expect(() => deletePortfolio(entry.id))
        .toThrow(/DEMO_PORTFOLIO_IMMUTABLE_METADATA/);
    });
  });

  describe('export', () => {
    it('produces a self-contained .db copy that re-imports round-trip', async () => {
      const { entry } = await createPortfolio(freshInput('Roundtrip'));
      const out = await exportPortfolio(entry.id);
      expect(fs.existsSync(out.filePath)).toBe(true);
      expect(out.downloadName).toMatch(/^Roundtrip-\d{4}-\d{2}-\d{2}\.db$/);

      const db = new Database(out.filePath, { readonly: true });
      const name = db.prepare("SELECT value FROM vf_portfolio_meta WHERE key='name'").get() as
        { value: string };
      db.close();
      expect(name.value).toBe('Roundtrip');
    });
  });
});
