// packages/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(os.tmpdir(), `quovibe-e2e-${Date.now()}.db`);
const schemaPath = path.resolve(__dirname, '../../data/schema.db');
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
      command: `cross-env DB_PATH="${testDbPath}" SCHEMA_PATH="${schemaPath}" pnpm --filter @quovibe/api dev`,
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
