import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2024, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooksPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'warn',
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
