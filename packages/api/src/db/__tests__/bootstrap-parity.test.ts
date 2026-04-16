// packages/api/src/db/__tests__/bootstrap-parity.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as schema from '../schema';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

/** Naive SQL parser: extract {table: {column: type}} from CREATE TABLE statements. */
function parseBootstrap(): Record<string, Record<string, string>> {
  const sql = readFileSync(join(__dirname, '..', 'bootstrap.sql'), 'utf-8');
  const tables: Record<string, Record<string, string>> = {};
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\(([\s\S]*?)\);/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(sql)) !== null) {
    const name = m[1];
    const body = m[2];
    const cols: Record<string, string> = {};
    // Split on commas at paren-depth 0
    let depth = 0, buf = '';
    const lines: string[] = [];
    for (const ch of body) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { lines.push(buf); buf = ''; }
      else buf += ch;
    }
    if (buf.trim()) lines.push(buf);
    for (const ln of lines) {
      // Strip SQL line comments before column-name parsing so `-- comment` on the
      // same line as a column declaration doesn't shadow the column name.
      const stripped = ln.replace(/--.*$/gm, '').trim();
      if (!stripped || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)/i.test(stripped)) continue;
      const colMatch = stripped.match(/^"?(\w+)"?\s+(\w+(?:\(\d+\))?)/);
      if (colMatch) cols[colMatch[1]] = colMatch[2].toUpperCase();
    }
    tables[name] = cols;
  }
  return tables;
}

/** OHLC columns declared by ppxml2db but never populated (spec allowance). */
const DRIZZLE_MISSING_ALLOWLIST = new Set([
  'price:high', 'price:low', 'price:volume',
  'latest_price:high', 'latest_price:low', 'latest_price:volume',
]);

describe('Gate 2: bootstrap.sql ↔ schema.ts parity', () => {
  const bootstrap = parseBootstrap();

  it('every Drizzle table exists in bootstrap.sql', () => {
    for (const key of Object.keys(schema)) {
      const t = (schema as Record<string, unknown>)[key];
      if (!t || typeof t !== 'object' || !('_' in t)) continue;
      let tableName: string;
      try { tableName = getTableConfig(t as never).name; } catch { continue; }
      expect(bootstrap[tableName], `Drizzle table '${tableName}' missing from bootstrap.sql`)
        .toBeTruthy();
    }
  });

  it('every Drizzle column has a bootstrap entry (or is allowlisted)', () => {
    for (const key of Object.keys(schema)) {
      const t = (schema as Record<string, unknown>)[key];
      if (!t || typeof t !== 'object' || !('_' in t)) continue;
      let cfg: ReturnType<typeof getTableConfig>;
      try { cfg = getTableConfig(t as never); } catch { continue; }
      for (const col of cfg.columns) {
        const pkey = `${cfg.name}:${col.name}`;
        if (DRIZZLE_MISSING_ALLOWLIST.has(pkey)) continue;
        expect(bootstrap[cfg.name]?.[col.name], `Drizzle ${pkey} not declared in bootstrap.sql`)
          .toBeTruthy();
      }
    }
  });
});
