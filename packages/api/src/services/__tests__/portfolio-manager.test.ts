// packages/api/src/services/__tests__/portfolio-manager.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import fs from 'fs';
import Database from 'better-sqlite3';
import type { PortfolioEntry } from '@quovibe/shared';

// Set env BEFORE importing anything that reads from config.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-pm-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

// Late-bound bindings populated in beforeAll.
let createPortfolio: (input: {
  source: 'fresh' | 'demo' | 'import-pp-xml' | 'import-quovibe-db';
  name: string;
  uploadedDbPath?: string;
  ppxmlTempDbPath?: string;
}) => Promise<{ entry: PortfolioEntry; alreadyExisted?: boolean }>;
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
      const { entry } = await createPortfolio({ source: 'fresh', name: 'Mine' });
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
        createPortfolio({ source: 'demo', name: 'x' }),
        createPortfolio({ source: 'demo', name: 'x' }),
      ]);
      expect(a.entry.id).toBe(b.entry.id);
      // Exactly one demo file on disk
      const files = fs.readdirSync(tmp).filter(f => f.startsWith('portfolio-demo.db'));
      expect(files.length).toBe(1);
    });
  });

  describe('rename', () => {
    it('updates vf_portfolio_meta.name and the sidecar entry', async () => {
      const { entry } = await createPortfolio({ source: 'fresh', name: 'Old' });
      const renamed = renamePortfolio(entry.id, 'New');
      expect(renamed.name).toBe('New');
      const db = new Database(path.join(tmp, `portfolio-${entry.id}.db`), { readonly: true });
      const row = db.prepare("SELECT value FROM vf_portfolio_meta WHERE key='name'").get() as
        { value: string };
      db.close();
      expect(row.value).toBe('New');
    });

    it('rejects rename of a demo portfolio', async () => {
      const { entry } = await createPortfolio({ source: 'demo', name: 'ignored' });
      expect(() => renamePortfolio(entry.id, 'Hacked'))
        .toThrow(/DEMO_PORTFOLIO_IMMUTABLE_METADATA/);
    });
  });

  describe('delete', () => {
    it('removes the file and sidecar entry, unlinks WAL siblings', async () => {
      const { entry } = await createPortfolio({ source: 'fresh', name: 'Doomed' });
      const dbPath = path.join(tmp, `portfolio-${entry.id}.db`);
      fs.writeFileSync(dbPath + '-wal', 'x');           // fake WAL to prove unlink happens
      deletePortfolio(entry.id);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(dbPath + '-wal')).toBe(false);
    });

    it('rejects delete of a demo portfolio', async () => {
      const { entry } = await createPortfolio({ source: 'demo', name: 'x' });
      expect(() => deletePortfolio(entry.id))
        .toThrow(/DEMO_PORTFOLIO_IMMUTABLE_METADATA/);
    });
  });

  describe('export', () => {
    it('produces a self-contained .db copy that re-imports round-trip', async () => {
      const { entry } = await createPortfolio({ source: 'fresh', name: 'Roundtrip' });
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
