import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TransactionType } from '@quovibe/shared';

// Locks the contract that every user-facing server error code has a translation
// in errors:server.<CODE>. Locale parity across the 8 locales is already
// enforced by `i18n-completeness.test.ts` via the recursive errors namespace
// walk, so this file is scoped to the coverage side only.

const ROUTES_DIR = join(__dirname, '..', '..', '..', 'api', 'src', 'routes');
const EN_ERRORS_PATH = join(__dirname, '..', 'i18n', 'locales', 'en', 'errors.json');

const SKIP_LIST = new Set<string>([
  // UUID / identifier-format validation from URL tampering
  'INVALID_CHART_ID',
  'INVALID_TABLE_ID',
  'INVALID_PORTFOLIO_ID',
  // Generic 500 catch-all from csv-import.ts. Intentionally NOT translated:
  // a translated "An unexpected server error occurred" would mask the
  // dev-mode raw-code path in `translateServerCode`, hiding the signal that
  // pinpoints which request class went wrong. Users see "Something went
  // wrong" (generic fallback) in prod; devs see "INTERNAL_ERROR" in dev.
  'INTERNAL_ERROR',
  // TransactionType enum values returned by the `normalizeType` classifier
  // in accounts.ts / transactions.ts. The guardReturnRegex below cannot
  // distinguish them from the error-returning guard helper, so we strip
  // them out by name (reusing the shared enum as the source of truth).
  ...Object.values(TransactionType),
]);

// `error: 'SCREAMING_SNAKE'` in res.status().json() payloads.
const EMIT_RE = /error:\s*'([A-Z][A-Z0-9_]+)'/g;
// `new XxxError('SCREAMING_SNAKE'` in service-layer errors that handleError maps.
const ERROR_CLASS_RE = /new\s+\w+Error\(\s*'([A-Z][A-Z0-9_]+)'/g;
// `return 'SCREAMING_SNAKE'` used by guard helpers that the caller forwards
// as `res.status().json({ error: guardResult })`.
const GUARD_RETURN_RE = /return\s+'([A-Z][A-Z0-9_]+)';/g;

function extractEmittedCodes(): Set<string> {
  const codes = new Set<string>();
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    const content = readFileSync(join(ROUTES_DIR, file), 'utf-8');
    for (const match of content.matchAll(EMIT_RE)) codes.add(match[1]);
    for (const match of content.matchAll(ERROR_CLASS_RE)) codes.add(match[1]);
    for (const match of content.matchAll(GUARD_RETURN_RE)) codes.add(match[1]);
  }
  return codes;
}

describe('error-translation-coverage: API codes have translations', () => {
  it('every emitted SCREAMING_SNAKE code has a server.<CODE> in en/errors.json (or is in SKIP_LIST)', () => {
    const emitted = extractEmittedCodes();
    const en = JSON.parse(readFileSync(EN_ERRORS_PATH, 'utf-8')) as { server?: Record<string, string> };
    const enKeys = new Set(Object.keys(en.server ?? {}));
    const missing = [...emitted].filter(
      (code) => !enKeys.has(code) && !SKIP_LIST.has(code),
    );
    expect(missing, 'codes emitted by routes but missing from en/errors.json server.*').toEqual([]);
  });
});
