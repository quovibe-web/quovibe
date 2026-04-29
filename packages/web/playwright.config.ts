// packages/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

// ADR-015: the API resolves per-portfolio .db paths from the sidecar under
// QUOVIBE_DATA_DIR. For E2E we point the API at an ephemeral data dir so
// tests never pollute the developer's real data/ folder.
const testDataDir = path.join(os.tmpdir(), `quovibe-e2e-${Date.now()}`);
fs.mkdirSync(testDataDir, { recursive: true });

const API_URL = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `cross-env QUOVIBE_DATA_DIR="${testDataDir}" pnpm --filter @quovibe/api dev`,
      url: `${API_URL}/api`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @quovibe/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
