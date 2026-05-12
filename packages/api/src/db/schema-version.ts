import type BetterSqlite3 from 'better-sqlite3';

/**
 * Current `vf_*` schema version this binary understands.
 *
 * Bump on any breaking change to a quovibe-owned (`vf_*`) table — column
 * rename, type change, removed table, payload shape that earlier readers
 * cannot parse. Additive changes (new optional column, new table, new
 * index) do NOT require a bump.
 *
 * Each bump must be paired with a migration step in `apply-bootstrap.ts`
 * that lifts N → N+1 in place, OR an explicit "no migration available"
 * outcome that rejects old DBs with `SCHEMA_VERSION_TOO_OLD`.
 */
export const CURRENT_PORTFOLIO_DB_SCHEMA_VERSION = 1;

export type SchemaVersionErrorCode =
  | 'SCHEMA_VERSION_TOO_OLD'
  | 'SCHEMA_VERSION_TOO_NEW'
  | 'SCHEMA_VERSION_CORRUPT';

export class SchemaVersionMismatchError extends Error {
  readonly code: SchemaVersionErrorCode;
  readonly stored: string | null;
  readonly expected: number;
  constructor(code: SchemaVersionErrorCode, stored: string | null, message: string) {
    super(message);
    this.name = 'SchemaVersionMismatchError';
    this.code = code;
    this.stored = stored;
    this.expected = CURRENT_PORTFOLIO_DB_SCHEMA_VERSION;
  }
}

/**
 * Must run AFTER `applyBootstrap()` — otherwise `vf_portfolio_meta` may not
 * exist yet. Missing row is OK: fresh-bootstrapped DBs land here until
 * `seedMeta()` (in `portfolio-manager.ts`) writes the initial row.
 */
export function verifyPortfolioSchemaVersion(db: BetterSqlite3.Database): void {
  const row = db
    .prepare(`SELECT value FROM vf_portfolio_meta WHERE key='schemaVersion'`)
    .get() as { value: string } | undefined;
  if (!row) return;

  const stored = row.value;
  const parsed = Number.parseInt(stored, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SchemaVersionMismatchError(
      'SCHEMA_VERSION_CORRUPT',
      stored,
      `[quovibe] vf_portfolio_meta.schemaVersion is not a positive integer: ${JSON.stringify(stored)}. ` +
        `The portfolio DB is likely corrupt. Restore from a backup or re-import from PP XML.`,
    );
  }

  if (parsed > CURRENT_PORTFOLIO_DB_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(
      'SCHEMA_VERSION_TOO_NEW',
      stored,
      `[quovibe] Portfolio DB schema version ${parsed} is newer than this binary supports ` +
        `(max ${CURRENT_PORTFOLIO_DB_SCHEMA_VERSION}). Upgrade quovibe to open this portfolio.`,
    );
  }

  if (parsed < CURRENT_PORTFOLIO_DB_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(
      'SCHEMA_VERSION_TOO_OLD',
      stored,
      `[quovibe] Portfolio DB schema version ${parsed} is older than this binary requires ` +
        `(${CURRENT_PORTFOLIO_DB_SCHEMA_VERSION}). No in-place migration is available; ` +
        `export the portfolio from an older quovibe build and re-import here.`,
    );
  }
}
