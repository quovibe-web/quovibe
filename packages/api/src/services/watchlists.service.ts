import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { watchlists } from '../db/schema';
import { safeDecimal } from './unit-conversion';

type DrizzleDb = BetterSQLite3Database<Record<string, unknown>>;

export async function updateWatchlistName(
  db: DrizzleDb,
  id: number,
  name: string,
): Promise<void> {
  await db.update(watchlists).set({ name }).where(eq(watchlists.id, id));
}

/** Converts a ppxml2db price integer (× 10^8) to a JS number. Returns null if input is null. */
export function convertWatchlistPriceFromDb(raw: number | null): number | null {
  if (raw == null) return null;
  return safeDecimal(raw).div(1e8).toNumber();
}

/**
 * Deletes a watchlist and all its security associations in a single transaction.
 */
export function deleteWatchlistById(
  sqlite: BetterSqlite3.Database,
  id: number,
): void {
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM watchlist_security WHERE list = ?').run(id);
    sqlite.prepare('DELETE FROM watchlist WHERE _id = ?').run(id);
  })();
}

interface WatchlistRow {
  _id: number;
  name: string;
  _order: number;
}

/**
 * Duplicates a watchlist (name + all securities) in a single transaction.
 * Returns the new watchlist row.
 */
export function duplicateWatchlistById(
  sqlite: BetterSqlite3.Database,
  sourceId: number,
  newName: string,
  newOrder: number,
): WatchlistRow {
  return sqlite.transaction(() => {
    const inserted = sqlite
      .prepare('INSERT INTO watchlist (name, _order) VALUES (?, ?) RETURNING _id, name, _order')
      .get(newName, newOrder) as WatchlistRow;

    const secRows = sqlite
      .prepare('SELECT security FROM watchlist_security WHERE list = ?')
      .all(sourceId) as Array<{ security: string }>;

    const insertSec = sqlite.prepare(
      'INSERT INTO watchlist_security (list, security) VALUES (?, ?)',
    );
    for (const row of secRows) {
      insertSec.run(inserted._id, row.security);
    }

    return inserted;
  })();
}
