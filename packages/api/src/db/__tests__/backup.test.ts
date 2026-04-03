import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * These tests verify the backup primitives (VACUUM INTO, checkpoint+copy,
 * rotation) directly, without importing backupDb — which triggers module
 * side-effects (DB open, startup backup) tied to DB_PATH.
 */

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qv-backup-'));
}

function createWalDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)');
  return db;
}

describe('backupDb primitives', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    // Clean up temp dir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('VACUUM INTO (WAL-safe with handle)', () => {
    test('produces a valid backup including WAL data', () => {
      const dbPath = path.join(tmpDir, 'test.db');
      const backupPath = path.join(tmpDir, 'test.db.bak');
      const db = createWalDb(dbPath);

      // Insert data — with WAL mode, data may be in the WAL file
      db.exec("INSERT INTO test_data (value) VALUES ('alpha'), ('beta'), ('gamma')");

      // Verify WAL file exists (data not yet checkpointed)
      const walPath = dbPath + '-wal';
      expect(fs.existsSync(walPath)).toBe(true);

      // Perform VACUUM INTO backup
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
      db.close();

      // The backup file must exist
      expect(fs.existsSync(backupPath)).toBe(true);

      // Open the backup and verify all data is present (including WAL data)
      const backupDb = new Database(backupPath, { readonly: true });
      const rows = backupDb.prepare('SELECT value FROM test_data ORDER BY id').all() as { value: string }[];
      backupDb.close();

      expect(rows).toHaveLength(3);
      expect(rows.map(r => r.value)).toEqual(['alpha', 'beta', 'gamma']);
    });

    test('backup is a standalone DB (no WAL/SHM files)', () => {
      const dbPath = path.join(tmpDir, 'test.db');
      const backupPath = path.join(tmpDir, 'test.db.bak');
      const db = createWalDb(dbPath);

      db.exec("INSERT INTO test_data (value) VALUES ('one')");
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
      db.close();

      // VACUUM INTO creates a standalone file — no WAL/SHM
      expect(fs.existsSync(backupPath + '-wal')).toBe(false);
      expect(fs.existsSync(backupPath + '-shm')).toBe(false);
    });
  });

  describe('checkpoint + copy fallback (without handle)', () => {
    test('produces a valid backup after checkpoint', () => {
      const dbPath = path.join(tmpDir, 'test.db');
      const backupPath = path.join(tmpDir, 'test.db.bak');

      // Create DB and insert data
      const db = createWalDb(dbPath);
      db.exec("INSERT INTO test_data (value) VALUES ('x'), ('y')");
      db.close();

      // Simulate the fallback path: open tmp connection, checkpoint, copy
      const tmp = new Database(dbPath);
      try {
        tmp.pragma('wal_checkpoint(TRUNCATE)');
        fs.copyFileSync(dbPath, backupPath);
      } finally {
        tmp.close();
      }

      expect(fs.existsSync(backupPath)).toBe(true);

      // Verify backup content
      const backupDb = new Database(backupPath, { readonly: true });
      const rows = backupDb.prepare('SELECT value FROM test_data ORDER BY id').all() as { value: string }[];
      backupDb.close();

      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.value)).toEqual(['x', 'y']);
    });
  });

  describe('backup rotation', () => {
    test('keeps only DB_BACKUP_MAX most recent backups', () => {
      const maxBackups = 3;
      const dbPath = path.join(tmpDir, 'test.db');
      const baseName = path.basename(dbPath);

      // Create dummy backup files with different timestamps
      const timestamps = [1000, 2000, 3000, 4000, 5000];
      for (const ts of timestamps) {
        const bakPath = path.join(tmpDir, `${baseName}.bak.${ts}`);
        fs.writeFileSync(bakPath, 'dummy');
      }

      // Run rotation logic (same as in backupDb)
      const dir = tmpDir;
      const base = baseName;
      const backups = fs.readdirSync(dir)
        .filter(f => f.startsWith(base + '.bak.'))
        .sort();

      while (backups.length > maxBackups) {
        const old = path.join(dir, backups.shift()!);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }

      // Verify only the 3 most recent remain
      const remaining = fs.readdirSync(dir)
        .filter(f => f.startsWith(base + '.bak.'))
        .sort();

      expect(remaining).toHaveLength(maxBackups);
      expect(remaining).toEqual([
        `${baseName}.bak.3000`,
        `${baseName}.bak.4000`,
        `${baseName}.bak.5000`,
      ]);
    });

    test('does not delete anything when under the limit', () => {
      const maxBackups = 5;
      const dbPath = path.join(tmpDir, 'test.db');
      const baseName = path.basename(dbPath);

      // Create 2 backup files (under limit of 5)
      for (const ts of [1000, 2000]) {
        fs.writeFileSync(path.join(tmpDir, `${baseName}.bak.${ts}`), 'dummy');
      }

      const backups = fs.readdirSync(tmpDir)
        .filter(f => f.startsWith(baseName + '.bak.'))
        .sort();

      while (backups.length > maxBackups) {
        const old = path.join(tmpDir, backups.shift()!);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }

      const remaining = fs.readdirSync(tmpDir)
        .filter(f => f.startsWith(baseName + '.bak.'))
        .sort();

      expect(remaining).toHaveLength(2);
    });
  });
});
