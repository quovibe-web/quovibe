// Governance test for BUG-PRE14-06: every React Query queryKey that carries a
// portfolio id must start with the literal `'portfolios'` so a global
// `invalidateQueries({queryKey: ['portfolios', pid]})` matches it. Without
// this prefix, pid-scoped queries survive cross-cutting invalidations
// (rename, delete, restore) and produce stale-data anomalies.
//
// Detection: scan `packages/web/src/**/*.ts(x)` for `queryKey:` array literals
// whose elements reference a portfolio-id-shaped identifier (`portfolioId`,
// `api.portfolioId`, `pid`). Assert the first element is the string literal
// `'portfolios'`.
//
// Allow-list: keys that intentionally live outside the portfolios prefix
// (registry-level lists, user preferences). Add to ALLOW_OUTSIDE_PORTFOLIOS
// only with a documented reason.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const SRC = join(ROOT, 'src');

const ALLOW_OUTSIDE_PORTFOLIOS = new Set<string>([
  // Registry-level + user-preference keys that legitimately do not carry a pid.
  'portfolios',
  'reporting-periods',
  'settings',
]);

const PID_IDENTIFIERS = ['portfolioId', 'api.portfolioId', 'pid'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(p);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  excerpt: string;
}

function findViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i]!.indexOf('queryKey:');
      if (idx < 0) continue;
      const after = lines[i]!.slice(idx + 'queryKey:'.length).trimStart();
      if (!after.startsWith('[')) continue;

      let depth = 0;
      let started = false;
      let buf = '';
      let endLine = i;
      const startCol = lines[i]!.indexOf('[', idx);
      outer: for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        for (const ch of lines[j]!.slice(j === i ? startCol : 0)) {
          if (ch === '[') { depth++; started = true; buf += ch; continue; }
          if (ch === ']') {
            depth--;
            buf += ch;
            if (started && depth === 0) { endLine = j; break outer; }
            continue;
          }
          if (started) buf += ch;
        }
        buf += ' ';
      }
      if (!started || depth !== 0) continue;

      const inner = buf.replace(/^\[/, '').replace(/\]$/, '').trim();
      if (!inner) continue;

      const carriesPid = PID_IDENTIFIERS.some(id =>
        new RegExp(`\\b${id.replace('.', '\\.')}\\b`).test(inner)
      );
      if (!carriesPid) continue;

      // Spread of a factory call: `[...accountsKeys.foo(pid, ...), ...]`.
      // Trust the factory; its own array-literal body is checked when this
      // walker reaches it.
      if (inner.startsWith('...')) continue;

      const firstMatch = /^['"]([^'"]+)['"]/.exec(inner);
      const firstSegment = firstMatch ? firstMatch[1] : null;

      if (firstSegment === 'portfolios') continue;
      if (firstSegment && ALLOW_OUTSIDE_PORTFOLIOS.has(firstSegment)) continue;

      violations.push({
        file: file.replace(ROOT, '').replace(/\\/g, '/'),
        line: i + 1,
        excerpt: lines.slice(i, endLine + 1).join('\n').trim(),
      });
    }
  }
  return violations;
}

describe('Query key convention (BUG-PRE14-06)', () => {
  it('every pid-scoped queryKey starts with the literal "portfolios"', () => {
    const violations = findViolations();
    if (violations.length > 0) {
      const msg = violations
        .map(v => `${v.file}:${v.line}\n  ${v.excerpt}`)
        .join('\n\n');
      throw new Error(
        `Found ${violations.length} pid-scoped queryKey(s) not prefixed with 'portfolios':\n\n${msg}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
