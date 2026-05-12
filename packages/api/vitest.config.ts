import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', '__tests__/**/*.test.ts', '__tests__/**/*.spec.ts', 'scripts/**/__tests__/**/*.test.mjs'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    setupFiles: ['./test-setup.ts'],
    globalSetup: ['./test-global-setup.ts'],
    // Most suites here are integration tests that boot Express + run
    // applyBootstrap() (multi-table DDL) + write the sidecar via fsync per
    // case. Under parallel Windows workers the default 5 s ceiling is tight
    // enough that worker contention surfaces as flake. 15 s leaves plenty of
    // headroom for honest work while still failing fast on genuine deadlocks.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
