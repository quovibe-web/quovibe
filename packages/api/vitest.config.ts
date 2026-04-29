import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', '__tests__/**/*.test.ts', '__tests__/**/*.spec.ts', 'scripts/**/__tests__/**/*.test.mjs'],
    exclude: ['**/dist/**', '**/node_modules/**'],
  },
})
