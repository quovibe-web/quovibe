import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { DB_PATH, SCHEMA_PATH } from './config';

// This module must be imported BEFORE client.ts (i.e., before app.ts).
// It copies schema.db → portfolio.db if the portfolio doesn't exist or has no valid schema.
// Works in both Docker (entrypoint also does this) and dev mode (pnpm dev).

function cleanWalFiles(): void {
  for (const suffix of ['-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

function needsBootstrap(): boolean {
  if (!fs.existsSync(DB_PATH)) return true;
  // WAL/SHM files must NOT be deleted here: they contain committed transactions
  // that SQLite recovers automatically on the next open. Deleting them causes data loss.
  // Check if existing DB has the required tables (fileMustExist prevents creating empty file)
  try {
    const tmp = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const row = tmp.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='account'").get() as { cnt: number };
    tmp.close();
    return row.cnt === 0;
  } catch {
    return true;
  }
}

// Resolve schema.db: check multiple locations (Docker prod, Docker dev, local dev).
const candidates = [
  path.join(path.dirname(DB_PATH), 'schema.db'),  // next to portfolio.db (dev, Docker dev)
  '/app/bootstrap/schema.db',                       // Docker production image
  SCHEMA_PATH,                                      // config fallback (cwd-based)
];
const resolvedSchemaPath = candidates.find(p => fs.existsSync(p)) ?? null;

if (needsBootstrap() && resolvedSchemaPath) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.copyFileSync(resolvedSchemaPath, DB_PATH);
  // Clean WAL/SHM only after replacing the DB file — the old WAL belongs to the old DB.
  cleanWalFiles();
  console.log(`[quovibe] Bootstrap: ${path.basename(resolvedSchemaPath)} → ${DB_PATH}`);
}
