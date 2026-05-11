import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { applyBootstrap } from './apply-bootstrap';
import { verifySchema, verifyColumnTypes } from './verify';

export interface OpenDatabaseResult {
  db: BetterSQLite3Database<Record<string, unknown>>;
  sqlite: BetterSqlite3.Database;
  closeDb: () => void;
}

/**
 * Opens a better-sqlite3 connection, sets pragmas, verifies schema,
 * applies bootstrap DDL, and returns drizzle + raw sqlite handles.
 * Can be called multiple times (no singleton state).
 */
export function openDatabase(dbPath: string): OpenDatabaseResult {
  const sqlite: BetterSqlite3.Database = new Database(dbPath);

  // Pragmas
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('foreign_keys = ON');

  // Verify schema
  const schemaResult = verifySchema(sqlite);
  if (!schemaResult.valid) {
    sqlite.close();
    throw new Error(
      `[quovibe] Schema non valido. Tabelle mancanti: ${schemaResult.missing.join(', ')}\n` +
      `Assicurarsi di aver eseguito ppxml2db prima di avviare quovibe.`
    );
  }
  schemaResult.warnings.forEach(w => console.warn('[quovibe]', w));

  // Verify column types (non-blocking)
  verifyColumnTypes(sqlite);

  // Apply bootstrap DDL (idempotent — creates vf_* tables, indexes)
  applyBootstrap(sqlite);

  const db = drizzle(sqlite, {
    schema,
  });

  const closeDb = () => sqlite.close();

  return { db, sqlite, closeDb };
}
