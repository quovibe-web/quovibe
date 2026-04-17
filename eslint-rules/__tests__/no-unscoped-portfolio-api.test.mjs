// eslint-rules/__tests__/no-unscoped-portfolio-api.test.mjs
import { RuleTester } from 'eslint';
import { describe, test } from 'vitest';
import rule from '../no-unscoped-portfolio-api.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe('no-unscoped-portfolio-api', () => {
  test('rule cases', () => {
    ruleTester.run('no-unscoped-portfolio-api', rule, {
      valid: [
        { code: "apiFetch('/api/events')" },
        { code: "apiFetch('/api/settings')" },
        { code: "apiFetch(`/api/p/${portfolioId}/performance/chart`)" },
        { code: "api.fetch('/api/performance/chart?foo=bar')" },
        { code: "api.fetch(`/api/performance/chart?periodStart=${s}&periodEnd=${e}`)" },
        { code: "scopedFetch('/api/performance/chart')" },
        { code: "apiFetch('/api/portfolios')" },
        { code: "apiFetch('/api/import/xml')" },
        { code: "apiFetch('/api/logos/resolve')" },
      ],
      invalid: [
        {
          code: "apiFetch('/api/performance/chart?periodStart=x&periodEnd=y')",
          errors: [{ messageId: 'unscopedPortfolioApi' }],
        },
        {
          code: "apiFetch(`/api/performance/chart?periodStart=${periodStart}&periodEnd=${periodEnd}`)",
          errors: [{ messageId: 'unscopedPortfolioApi' }],
        },
        {
          code: "apiFetch('/api/accounts/123')",
          errors: [{ messageId: 'unscopedPortfolioApi' }],
        },
        {
          code: "apiFetch(`/api/reports/statement-of-assets?periodStart=${s}`)",
          errors: [{ messageId: 'unscopedPortfolioApi' }],
        },
      ],
    });
  });
});
