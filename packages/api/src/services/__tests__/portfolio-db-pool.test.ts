// packages/api/src/services/__tests__/portfolio-db-pool.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import type { PortfolioEntry } from '@quovibe/shared';
import { applyBootstrap } from '../../db/apply-bootstrap';

// Override DATA_DIR via env BEFORE importing the pool/config.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-pool-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.PORTFOLIO_POOL_MAX = '3';

// Late-bound bindings: populated by beforeAll after env is set.
let setResolveEntry: (fn: (id: string) => PortfolioEntry | null) => void;
let acquirePortfolioDb: (id: string) => { sqlite: Database.Database };
let releasePortfolioDb: (id: string) => void;
let evictPortfolioDb: (id: string) => void;
let closeAllPooledHandles: () => void;
let _poolStateForTests: () => { size: number; entries: Array<{ id: string; refCount: number }> };

function makePortfolioFile(id: string): void {
  const p = path.join(tmp, `portfolio-${id}.db`);
  const db = new Database(p);
  applyBootstrap(db);
  db.close();
}

const IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
];

describe('portfolio-db-pool', () => {
  beforeAll(async () => {
    const mod = await import('../portfolio-db-pool');
    setResolveEntry = mod.setResolveEntry;
    acquirePortfolioDb = mod.acquirePortfolioDb;
    releasePortfolioDb = mod.releasePortfolioDb;
    evictPortfolioDb = mod.evictPortfolioDb;
    closeAllPooledHandles = mod.closeAllPooledHandles;
    _poolStateForTests = mod._poolStateForTests;
  });

  beforeEach(() => {
    for (const id of IDS) makePortfolioFile(id);
    setResolveEntry((id: string) => IDS.includes(id)
      ? { id, name: 't', kind: 'real' as const, source: 'fresh' as const, createdAt: '', lastOpenedAt: null }
      : null,
    );
  });
  afterEach(() => {
    closeAllPooledHandles();
  });

  it('returns independent handles for two portfolios', () => {
    const a = acquirePortfolioDb(IDS[0]);
    const b = acquirePortfolioDb(IDS[1]);
    expect(a).not.toBe(b);
    expect(a.sqlite).not.toBe(b.sqlite);
    releasePortfolioDb(IDS[0]);
    releasePortfolioDb(IDS[1]);
  });

  it('evicts oldest idle handle when size > MAX', () => {
    for (const id of IDS.slice(0, 4)) {             // exceed cap of 3
      acquirePortfolioDb(id);
      releasePortfolioDb(id);
    }
    const state = _poolStateForTests();
    expect(state.size).toBe(3);
  });

  it('never evicts a handle while refCount > 0', () => {
    const a = acquirePortfolioDb(IDS[0]);             // refCount=1, won't be evicted
    for (const id of IDS.slice(1, 6)) {               // open 5 more → 6 total, cap=3
      acquirePortfolioDb(id);
    }
    const state = _poolStateForTests();
    expect(state.size).toBe(6);                       // all busy, over soft cap
    // A is still usable
    const row = a.sqlite.prepare("SELECT 1 as v").get() as { v: number };
    expect(row.v).toBe(1);
    // Release all
    for (const id of IDS.slice(0, 6)) releasePortfolioDb(id);
    const after = _poolStateForTests();
    expect(after.size).toBeLessThanOrEqual(3);
  });

  it('evictPortfolioDb removes a specific handle', () => {
    acquirePortfolioDb(IDS[0]);
    releasePortfolioDb(IDS[0]);
    evictPortfolioDb(IDS[0]);
    expect(_poolStateForTests().entries).toHaveLength(0);
  });

  it('acquirePortfolioDb throws PORTFOLIO_NOT_FOUND for unknown id', () => {
    expect(() => acquirePortfolioDb('00000000-0000-4000-8000-ffffffffffff'))
      .toThrow(/PORTFOLIO_NOT_FOUND/);
  });
});
