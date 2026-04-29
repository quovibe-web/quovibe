// packages/api/src/services/__tests__/portfolio-db-pool-eviction-hook.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import type { PortfolioEntry } from '@quovibe/shared';
import { applyBootstrap } from '../../db/apply-bootstrap';

// Override DATA_DIR via env BEFORE importing the pool/config.
const tmp = mkdtempSync(path.join(tmpdir(), 'qv-pool-evict-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.PORTFOLIO_POOL_MAX = '3';

// Late-bound bindings: populated by beforeAll after env is set.
let setResolveEntry: (fn: (id: string) => PortfolioEntry | null) => void;
let setOnEvicted: (fn: (id: string) => void) => void;
let acquirePortfolioDb: (id: string) => { sqlite: Database.Database };
let releasePortfolioDb: (id: string) => void;
let evictPortfolioDb: (id: string) => void;
let closeAllPooledHandles: () => void;

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
];

describe('setOnEvicted', () => {
  beforeAll(async () => {
    const mod = await import('../portfolio-db-pool');
    setResolveEntry = mod.setResolveEntry;
    setOnEvicted = mod.setOnEvicted;
    acquirePortfolioDb = mod.acquirePortfolioDb;
    releasePortfolioDb = mod.releasePortfolioDb;
    evictPortfolioDb = mod.evictPortfolioDb;
    closeAllPooledHandles = mod.closeAllPooledHandles;
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
    // hooks accumulate within the file's module scope; vitest file-isolation
    // gives each test a fresh module, and each test uses fresh vi.fn() refs.
  });

  it('hook fires when evictPortfolioDb is called', () => {
    const hook = vi.fn<(id: string) => void>();
    setOnEvicted(hook);

    acquirePortfolioDb(IDS[0]);
    releasePortfolioDb(IDS[0]);
    evictPortfolioDb(IDS[0]);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(IDS[0]);
  });

  it('hook does not fire on release alone', () => {
    const hook = vi.fn<(id: string) => void>();
    setOnEvicted(hook);

    acquirePortfolioDb(IDS[0]);
    releasePortfolioDb(IDS[0]);

    expect(hook).not.toHaveBeenCalled();
  });

  it('hook fires when idle-over-cap eviction runs', () => {
    const hook = vi.fn<(id: string) => void>();
    setOnEvicted(hook);

    // PORTFOLIO_POOL_MAX is 3 in this test process. Acquire+release 5 entries
    // and confirm at least one eviction fires the hook.
    for (const id of IDS) {
      acquirePortfolioDb(id);
      releasePortfolioDb(id);
    }

    expect(hook).toHaveBeenCalled();
    // We opened 5 unique portfolios with cap=3, so exactly 2 should have been evicted.
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('multiple setOnEvicted callers all fire (append semantics)', () => {
    const a = vi.fn<(id: string) => void>();
    const b = vi.fn<(id: string) => void>();
    setOnEvicted(a);
    setOnEvicted(b);

    acquirePortfolioDb(IDS[0]);
    releasePortfolioDb(IDS[0]);
    evictPortfolioDb(IDS[0]);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
