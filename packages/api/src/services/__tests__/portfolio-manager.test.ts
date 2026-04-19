// packages/api/src/services/__tests__/portfolio-manager.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import fs from 'fs';
import Database from 'better-sqlite3';
import type { PortfolioEntry } from '@quovibe/shared';
import type { CreatePortfolioInput, FreshPortfolioInput } from '../portfolio-manager';

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
let setupPortfolio: (id: string, input: Omit<FreshPortfolioInput, 'name'>) => void;
let acquirePortfolioDb: (id: string) => { sqlite: import('better-sqlite3').Database };
let releasePortfolioDb: (id: string) => void;
let listSecuritiesAccounts: typeof import('../accounts.service').listSecuritiesAccounts;
let AccountServiceError: typeof import('../accounts.service').AccountServiceError;
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
    setupPortfolio = pm.setupPortfolio;

    const pool = await import('../portfolio-db-pool');
    acquirePortfolioDb = pool.acquirePortfolioDb as typeof acquirePortfolioDb;
    releasePortfolioDb = pool.releasePortfolioDb;

    const accounts = await import('../accounts.service');
    listSecuritiesAccounts = accounts.listSecuritiesAccounts;
    AccountServiceError = accounts.AccountServiceError;

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

  // BUG-54/55 Phase 2 — Task 2.5. Setup is the inverse of createFreshImpl: it
  // populates the M3 default account layout for an already-existing portfolio
  // whose inner DB is in the legacy N=0 state. Locks the three invariants
  // listed in the plan: legacy-seeds, ALREADY_SETUP guard, and DUPLICATE_NAME
  // propagation from the inner accounts.service.
  describe('setupPortfolio', () => {
    // Force the legacy N=0 state inline (no need for the test-_helpers fixture
    // here — this file already has its own env wiring + late-bound bindings).
    async function makeLegacyN0(name: string): Promise<string> {
      const { entry } = await createPortfolio(freshInput(name));
      const { sqlite } = acquirePortfolioDb(entry.id);
      try {
        sqlite.prepare('DELETE FROM account').run();
      } finally {
        releasePortfolioDb(entry.id);
      }
      return entry.id;
    }

    it('seeds accounts for a legacy N=0 portfolio', async () => {
      const id = await makeLegacyN0('Legacy');
      setupPortfolio(id, {
        baseCurrency: 'EUR',
        securitiesAccountName: 'Main Securities',
        primaryDeposit: { name: 'Cash' },
        extraDeposits: [],
      });

      const { sqlite } = acquirePortfolioDb(id);
      try {
        expect(listSecuritiesAccounts(sqlite)).toHaveLength(1);
      } finally {
        releasePortfolioDb(id);
      }
    });

    it('throws ALREADY_SETUP when N>=1', async () => {
      // createPortfolio({source:'fresh',...}) already seeds N=1, so this
      // exercises the guard without touching the legacy strip step.
      const { entry } = await createPortfolio(freshInput('AlreadySet'));

      expect(() =>
        setupPortfolio(entry.id, {
          baseCurrency: 'USD',
          securitiesAccountName: 'Second',
          primaryDeposit: { name: 'Other Cash' },
          extraDeposits: [],
        }),
      ).toThrow(expect.objectContaining({ code: 'ALREADY_SETUP' }));
    });

    it('throws AccountServiceError DUPLICATE_NAME when primary and an extra deposit share a name', async () => {
      const id = await makeLegacyN0('DupTest');
      // Pin both class identity AND code: the route layer dispatches on
      // `err instanceof AccountServiceError` (not on `.code` alone), so a
      // future refactor that accidentally re-wraps this error in a plain
      // PortfolioManagerError would silently regress the 409 mapping.
      let caught: unknown;
      try {
        setupPortfolio(id, {
          baseCurrency: 'EUR',
          securitiesAccountName: 'Main',
          primaryDeposit: { name: 'Cash' },
          extraDeposits: [{ name: 'Cash', currency: 'USD' }],
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AccountServiceError);
      expect((caught as { code: string }).code).toBe('DUPLICATE_NAME');
    });
  });
});
