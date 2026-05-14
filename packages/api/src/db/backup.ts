// packages/api/src/db/backup.ts
import type BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DB_BACKUP_MAX, resolvePortfolioPath } from '../config';
import { getPortfolioEntry } from '../services/portfolio-registry';

/**
 * Create a rotated `.bak.{ts}` file next to the portfolio's `.db` file.
 *
 * Requires an open handle (the caller already acquired it from the pool).
 * Uses `VACUUM INTO` which is WAL-safe and produces a standalone DB file
 * (no accompanying -wal/-shm). Returns the backup path, or the empty string
 * if the source DB does not exist on disk (e.g. `:memory:`).
 */
export function backupDb(portfolioId: string, sqlite: BetterSqlite3.Database): string {
  const entry = getPortfolioEntry(portfolioId);
  if (!entry) throw new Error('backupDb: portfolio not found');
  const srcPath = resolvePortfolioPath(entry);
  if (!fs.existsSync(srcPath)) return '';
  const backupPath = srcPath + '.bak.' + Date.now();
  sqlite.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  rotateBackups(srcPath);
  return backupPath;
}

function rotateBackups(srcPath: string): void {
  const dir = path.dirname(srcPath);
  const base = path.basename(srcPath);
  const backups = fs.readdirSync(dir)
    .filter(f => f.startsWith(base + '.bak.'))
    .sort();
  while (backups.length > DB_BACKUP_MAX) {
    const old = path.join(dir, backups.shift()!);
    try { fs.unlinkSync(old); } catch { /* ok */ }
  }
}
