#!/usr/bin/env node
// packages/api/scripts/normalize-bootstrap.mjs
// Deterministic text transform used by Gate 1 to compare ppxml2db_init.py output
// against packages/api/src/db/bootstrap.sql modulo whitespace / comments / quotes.
//
// Rules (pinned by normalize-bootstrap.test.mjs):
//  1. Strip `--` line comments and `/* ... */` block comments.
//  2. Collapse whitespace runs to a single space; trim.
//  3. Remove `IF NOT EXISTS` from CREATE TABLE / CREATE INDEX / ALTER TABLE ADD COLUMN.
//  4. Lowercase SQL keywords (CREATE, TABLE, NOT NULL, PRIMARY KEY, REFERENCES, ...).
//  5. Normalize identifier/string quotes: `"x"` → `"x"`, `'x'` → `'x'` (no backticks).
//  6. Sort CREATE INDEX statements alphabetically within the file (tables stay in emission order).
//  7. Strip trailing semicolons and blank lines.
//
// Flag: --strip-quovibe-section
//  Removes everything at and after the literal marker line `-- ═══ QUOVIBE SECTION BEGIN ═══`.

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const MARKER = '-- ═══ QUOVIBE SECTION BEGIN ═══';

const KEYWORDS = [
  'CREATE', 'TABLE', 'INDEX', 'UNIQUE', 'IF', 'NOT', 'EXISTS',
  'PRIMARY', 'KEY', 'REFERENCES', 'DEFAULT', 'NULL', 'ON', 'ALTER',
  'ADD', 'COLUMN', 'AUTOINCREMENT',
  // Data types & literals (needed so pinned test cases pass and ppxml2db_init.py
  // output — which emits mixed-case data types — normalizes identically).
  'INT', 'INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC', 'BOOLEAN', 'CHECK',
];

function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function collapseWhitespace(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function removeIfNotExists(sql) {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, '');
}

function lowercaseKeywords(sql) {
  // Only lowercase keywords in contexts where they aren't inside quotes.
  // Simple heuristic: split by quoted strings, lowercase keywords in non-quoted parts.
  const parts = sql.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
  for (let i = 0; i < parts.length; i += 2) {
    for (const kw of KEYWORDS) {
      const re = new RegExp(`\\b${kw}\\b`, 'gi');
      parts[i] = parts[i].replace(re, kw.toLowerCase());
    }
  }
  return parts.join('');
}

function normalizeQuotes(sql) {
  return sql.replace(/`([^`]+)`/g, '"$1"');
}

function splitStatements(sql) {
  return sql
    .split(/;/g)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function sortIndexes(stmts) {
  const indexes = [];
  const rest = [];
  for (const s of stmts) {
    if (/^create\s+(unique\s+)?index\b/i.test(s)) indexes.push(s);
    else rest.push(s);
  }
  indexes.sort();
  return [...rest, ...indexes];
}

export function normalize(sql) {
  let out = stripComments(sql);
  out = normalizeQuotes(out);
  out = lowercaseKeywords(out);
  out = removeIfNotExists(out);
  let stmts = splitStatements(out);
  stmts = stmts.map(collapseWhitespace);
  stmts = sortIndexes(stmts);
  return stmts.join(';\n');
}

function main() {
  const args = process.argv.slice(2);
  const stripIdx = args.indexOf('--strip-quovibe-section');
  const stripQuovibe = stripIdx >= 0;
  if (stripQuovibe) args.splice(stripIdx, 1);
  const file = args[0];
  if (!file) {
    console.error('usage: normalize-bootstrap.mjs <file> [--strip-quovibe-section]');
    process.exit(2);
  }
  let sql = readFileSync(file, 'utf-8');
  if (stripQuovibe) {
    const i = sql.indexOf(MARKER);
    if (i < 0) {
      console.error(`ERROR: marker not found in ${file}: ${MARKER}`);
      process.exit(3);
    }
    sql = sql.slice(0, i);
  }
  process.stdout.write(normalize(sql));
}

// When invoked as a script (not imported as a module):
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
