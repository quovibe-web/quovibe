#!/usr/bin/env node
// packages/api/scripts/dump-schema.mjs
// Node/better-sqlite3 replacement for `sqlite3 file.db .schema`.
// Dumps all CREATE TABLE / CREATE INDEX statements from the target DB in
// sqlite_master rowid order (== creation order, which is what sqlite3 CLI does).
// Usage: node dump-schema.mjs <db-path>

import Database from 'better-sqlite3';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: dump-schema.mjs <db-path>');
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare(
    `SELECT sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY rowid`,
  )
  .all();
db.close();

process.stdout.write(rows.map((r) => r.sql + ';').join('\n') + '\n');
