// Vitest global setup. Runs ONCE in the parent process before any worker
// forks, so the QUOVIBE_DATA_DIR env override propagates to every worker
// and every test file regardless of ESM import hoisting.
//
// Without this guard, a test file's static `import { seedFreshPortfolio }`
// resolved transitive dependencies of `config.ts` BEFORE the test's own
// top-level `process.env.QUOVIBE_DATA_DIR = tmp` line executed. Result:
// `DATA_DIR` cached to the project default `c:/quovibe/data/` and tests
// silently polluted the working tree with `Fresh-<timestamp>` portfolios.
//
// Tests that set their own QUOVIBE_DATA_DIR at module top still take
// effect — but only if their own setting reaches config.ts before any
// other module reads it. Even when they don't, the worst case is now
// "writes land in the per-session tmp dir we created here", not
// "writes land in the project's working tree".
import { mkdtempSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

let sessionTmp: string | null = null;

export async function setup(): Promise<void> {
  sessionTmp = mkdtempSync(path.join(tmpdir(), 'qv-vitest-'));
  process.env.QUOVIBE_DATA_DIR = sessionTmp;
}

export async function teardown(): Promise<void> {
  if (!sessionTmp) return;
  try { rmSync(sessionTmp, { recursive: true, force: true }); } catch { /* ok */ }
}
