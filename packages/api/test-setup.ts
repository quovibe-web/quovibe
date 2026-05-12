// Vitest global setup. Loaded BEFORE any test file's top-level imports
// resolve, so `config.ts`'s one-shot DATA_DIR cache picks up our env
// override even if the test file's own `process.env.QUOVIBE_DATA_DIR = ...`
// line runs after ESM-hoisted imports.
//
// Without this setup, any test that imported `seedFreshPortfolio` (or any
// helper that transitively touches `config.ts`) would resolve `DATA_DIR`
// to the project default `c:/quovibe/data/` and pollute it with
// `Fresh-<timestamp>` portfolio files. The pollution survived test exit
// and bloated the working tree. Tests that DO want their own per-suite
// tmpdir still override the env at their own top — that takes effect
// because each test file's `tmpdir()` is fresh per-process.
import { mkdtempSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

if (!process.env.QUOVIBE_DATA_DIR || process.env.QUOVIBE_DATA_DIR.endsWith('quovibe/data')) {
  const fallback = mkdtempSync(path.join(tmpdir(), 'qv-vitest-setup-'));
  process.env.QUOVIBE_DATA_DIR = fallback;
}
