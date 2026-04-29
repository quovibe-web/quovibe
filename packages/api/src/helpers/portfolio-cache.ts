// Typed per-portfolio cache keyed by SQLite-handle identity.
//
// The portfolio-db-pool returns a distinct `better-sqlite3` Database instance
// per portfolio id, and entries are evicted (and the handle closed) when the
// pool drops them. A `WeakMap<Database, T>` therefore cannot leak across
// portfolios (each handle is unique per portfolio) and releases its entry
// automatically when the handle is GC'd after eviction.
//
// This is the sanctioned pattern for cross-request portfolio-scoped caches,
// reserved for hotspots that profiling proves need server-side memoization.
// Prefer passing state through function parameters when possible.
//
// ADR-016 — Portfolio-scoped state locality.

import type BetterSqlite3 from 'better-sqlite3';

export class PortfolioCache<T> {
  private readonly map = new WeakMap<BetterSqlite3.Database, T>();

  get(sqlite: BetterSqlite3.Database): T | undefined {
    return this.map.get(sqlite);
  }

  set(sqlite: BetterSqlite3.Database, value: T): void {
    this.map.set(sqlite, value);
  }

  delete(sqlite: BetterSqlite3.Database): void {
    this.map.delete(sqlite);
  }

  has(sqlite: BetterSqlite3.Database): boolean {
    return this.map.has(sqlite);
  }
}
