import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/api/vitest.config.ts',
      'packages/engine/vitest.config.ts',
      'packages/shared/vitest.config.ts',
      'packages/web/vitest.config.ts',
    ],
  },
})
