// Tests for the custom ESLint rule that enforces ADR-016
// (no module-scope mutable state that could hold portfolio data).
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
// @ts-expect-error — pure ESM rule, no types published.
import rule from '../../../../eslint-rules/no-portfolio-scope-module-state.mjs';

// Bridge ESLint's RuleTester harness to vitest's it/describe so that each
// rule test case becomes its own reported test in the vitest output.
(RuleTester as unknown as { it: typeof it; describe: typeof describe }).it = it;
(RuleTester as unknown as { it: typeof it; describe: typeof describe }).describe = describe;

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaVersion: 2024, sourceType: 'module' } },
});

tester.run('no-portfolio-scope-module-state', rule, {
  valid: [
    // Readonly-by-convention enum patterns have arguments, so they are allowed.
    { code: `const TYPES = new Set(['BUY', 'SELL']);` },
    { code: `const MAP = new Map([['a', 1], ['b', 2]]);` },
    // Primitive constants are fine.
    { code: `const TTL = 30_000;` },
    // Frozen config objects are fine.
    { code: `const CONFIG = Object.freeze({ a: 1 });` },
    // Allow-listed let with a justification.
    {
      code: `
// quovibe:allow-module-state — HTTP client singleton; portfolio-agnostic.
let client = null;
`,
    },
    // Allow-listed empty Map with em-dash.
    {
      code: `
// quovibe:allow-module-state — process-wide portfolio-id dedup.
const ids = new Set();
`,
    },
    // Allow-list works on exported declarations.
    {
      code: `
// quovibe:allow-module-state — the pool itself IS the portfolio scope.
export const pool = new Map();
`,
    },
    // Function-scope let is fine.
    { code: `function foo() { let x = 1; return x; }` },
  ],
  invalid: [
    // Bare module-scope let is forbidden.
    {
      code: `let cache = null;`,
      errors: [{ messageId: 'noLet', data: { kind: 'let' } }],
    },
    // Bare module-scope var is forbidden.
    {
      code: `var cache = null;`,
      errors: [{ messageId: 'noLet', data: { kind: 'var' } }],
    },
    // Empty new Map() is the leak pattern.
    {
      code: `const cache = new Map();`,
      errors: [{ messageId: 'noEmptyCtor', data: { ctor: 'Map' } }],
    },
    // Empty new Set() too.
    {
      code: `const ids = new Set();`,
      errors: [{ messageId: 'noEmptyCtor', data: { ctor: 'Set' } }],
    },
    // Empty new WeakMap()/WeakSet() also forbidden (use PortfolioCache<T>).
    {
      code: `const refs = new WeakMap();`,
      errors: [{ messageId: 'noEmptyCtor', data: { ctor: 'WeakMap' } }],
    },
    // Exported empty Map() is still caught.
    {
      code: `export const cache = new Map();`,
      errors: [{ messageId: 'noEmptyCtor', data: { ctor: 'Map' } }],
    },
    // Allow-comment without a justification is rejected.
    {
      code: `
// quovibe:allow-module-state —
let cache = null;
`,
      errors: [{ messageId: 'noLet', data: { kind: 'let' } }],
    },
    // Allow-comment with hyphen but NO reason is rejected (regex requires \\S after delimiter).
    {
      code: `
// quovibe:allow-module-state -
let cache = null;
`,
      errors: [{ messageId: 'noLet', data: { kind: 'let' } }],
    },
    // Completely unrelated comment doesn't count as allow-list.
    {
      code: `
// some unrelated comment
let cache = null;
`,
      errors: [{ messageId: 'noLet', data: { kind: 'let' } }],
    },
  ],
});
