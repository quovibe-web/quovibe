// Structural test that locks the cross-portfolio navigation contract:
// PortfolioSwitcher.pick MUST pass `flushSync: true` to react-router's
// `navigate(...)` so React commits the route change synchronously.
//
// Without flushSync, navigate schedules an async render. The prior
// portfolio's painted pixels (TopBar header, document.title, dashboard MV)
// stay on screen until React's next commit (~40 ms), producing the
// cross-portfolio render flash. The complementary `key={portfolioId}` on
// PortfolioLayout's Outlet drives body queries to a fresh loading state
// but cannot reduce the commit lag itself — only flushSync can.
//
// This test is text-level (per project convention, web tests are
// pure-helper-level — no @testing-library/user-event). It fails the
// moment a regression strips the flushSync option.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(__dirname, 'PortfolioSwitcher.tsx'),
  'utf-8',
);

describe('PortfolioSwitcher cross-portfolio nav (flushSync wiring)', () => {
  it('passes flushSync: true to navigate inside pick()', () => {
    // Locate the pick function body. Matches `const pick = (id: string)` …
    // up to its closing brace.
    const pickMatch = SOURCE.match(/const\s+pick\s*=\s*\([^)]*\)\s*:[^=]*=>\s*\{([\s\S]*?)\n\s*\};/);
    expect(pickMatch, 'pick arrow-function body not found').toBeTruthy();
    const body = pickMatch![1];

    // The body MUST call navigate with a second argument that contains
    // `flushSync: true`. Tolerate whitespace and other unrelated options
    // in the same object literal.
    expect(body).toMatch(/navigate\s*\([^)]*,\s*\{[^}]*\bflushSync\s*:\s*true\b/);
  });

  it('does not navigate without options (regression guard)', () => {
    // The exact bug shape this test pins: `navigate(\`/p/...\`)` with no
    // options object. If a regression reverts the second argument, this
    // assertion fires.
    const body = SOURCE.match(/const\s+pick\s*=\s*\([^)]*\)\s*:[^=]*=>\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? '';
    // The bare-call shape (template literal then `)` with no comma) is
    // disallowed inside pick.
    expect(body).not.toMatch(/navigate\s*\(\s*`[^`]+`\s*\)\s*;/);
  });
});
