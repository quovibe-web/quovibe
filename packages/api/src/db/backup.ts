import type BetterSqlite3 from 'better-sqlite3';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DB_PATH, DB_BACKUP_MAX } from '../config';

export function backupDb(sqliteHandle?: BetterSqlite3.Database): string {
  if (DB_PATH.includes(':memory:') || !fs.existsSync(DB_PATH)) return '';
  const backupPath = DB_PATH + '.bak.' + Date.now();

  if (sqliteHandle) {
    // Preferred: VACUUM INTO via the open connection — includes all WAL data
    sqliteHandle.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } else {
    // Fallback: checkpoint + copy (for contexts without an open handle)
    const tmp = new Database(DB_PATH);
    try {
      tmp.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(DB_PATH, backupPath);
    } finally {
      tmp.close();
    }
  }

  // Rotate: keep only DB_BACKUP_MAX most recent backups
  const dir = path.dirname(DB_PATH);
  const base = path.basename(DB_PATH);
  const backups = fs.readdirSync(dir)
    .filter(f => f.startsWith(base + '.bak.'))
    .sort();
  while (backups.length > DB_BACKUP_MAX) {
    const old = path.join(dir, backups.shift()!);
    try { fs.unlinkSync(old); } catch { /* already deleted or busy — ignore */ }
  }
  return backupPath;
}
