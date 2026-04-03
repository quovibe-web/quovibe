import type BetterSqlite3 from 'better-sqlite3';
import { config } from 'dotenv';
import { DB_PATH } from '../config';
import { openDatabase } from './open-db';
export { backupDb } from './backup';

// Re-export type so consumers can reference it
export type { BetterSqlite3 };

config({ quiet: true });

// Legacy singleton — used only by app.ts (alternative entry point).
// index.ts manages its own connection via buildFullApp(); do NOT import this
// from index.ts, as it opens an extra connection that blocks TRUNCATE checkpoints.
const handle = openDatabase(DB_PATH);

export const db = handle.db;
export const sqlite: BetterSqlite3.Database = handle.sqlite;
export const closeDb = handle.closeDb;
