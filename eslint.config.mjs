import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import noPortfolioScopeModuleState from './eslint-rules/no-portfolio-scope-module-state.mjs';
import noUnscopedPortfolioApi from './eslint-rules/no-unscoped-portfolio-api.mjs';

export default [
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2024, sourceType: 'module' },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksPlugin,
      quovibe: { rules: { 'no-portfolio-scope-module-state': noPortfolioScopeModuleState, 'no-unscoped-portfolio-api': noUnscopedPortfolioApi } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // ADR-016: portfolio-scoped state must flow through function parameters,
  // `req`, or PortfolioCache<T>. Block new module-scope mutable state on both
  // tiers; existing legitimate cases are whitelisted via magic comments.
  // Test files are excluded — module-scope `let` for lazy-imported typeof
  // declarations is a standard harness pattern (see multi-portfolio-concurrency.test.ts).
  {
    files: ['packages/api/src/**/*.ts', 'packages/web/src/**/*.{ts,tsx}'],
    ignores: [
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'packages/api/src/tests/**',
    ],
    rules: {
      'quovibe/no-portfolio-scope-module-state': 'error',
      'quovibe/no-unscoped-portfolio-api': 'error',
    },
  },
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            'better-sqlite3', 'drizzle-orm', 'express', 'yahoo-finance2',
            'fs', 'path', 'http', 'https',
            'node:fs', 'node:path', 'node:http', 'node:https',
            'node:net', 'node:child_process', 'node:worker_threads',
          ],
          message: 'The engine must not have I/O dependencies (ADR-003).',
        }],
      }],
    },
  },
  { ignores: ['**/dist/**', '**/node_modules/**', 'packages/web/src/components/ui/**'] },
];
