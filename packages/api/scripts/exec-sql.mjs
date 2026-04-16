#!/usr/bin/env node
// packages/api/scripts/exec-sql.mjs
// Node/better-sqlite3 replacement for `sqlite3 file.db < file.sql`.
// Opens (or creates) <db-path> and execs the contents of <sql-file>.
// Usage: node exec-sql.mjs <db-path> <sql-file>

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';

const [dbPath, sqlPath] = process.argv.slice(2);
if (!dbPath || !sqlPath) {
  console.error('usage: exec-sql.mjs <db-path> <sql-file>');
  process.exit(2);
}

const sql = readFileSync(sqlPath, 'utf-8');
const db = new Database(dbPath);
db.exec(sql);
db.close();
