import type BetterSqlite3 from 'better-sqlite3';
import { getStatementOfAssets } from './performance.service';

// ─── Statement Cache ──────────────────────────────────────────────────────────
// Shared TTL cache for getStatementOfAssets. Avoids recomputing when multiple
// routes (reports, rebalancing) request data for the same date in quick succession.

let statementCache: {
  date: string;
  result: ReturnType<typeof getStatementOfAssets>;
  ts: number;
} | null = null;

const STATEMENT_CACHE_TTL = 30_000; // 30 seconds

export function getCachedStatement(
  sqlite: BetterSqlite3.Database,
  date: string,
): ReturnType<typeof getStatementOfAssets> {
  const now = Date.now();
  if (
    statementCache &&
    statementCache.date === date &&
    now - statementCache.ts < STATEMENT_CACHE_TTL
  ) {
    return statementCache.result;
  }
  const result = getStatementOfAssets(sqlite, date);
  statementCache = { date, result, ts: now };
  return result;
}

// ─── Reference Data Cache ─────────────────────────────────────────────────────
// Caches static reference data (securities list, accounts list, logos) that is
// identical across all taxonomy requests. TTL 60s — these change only on manual
// edits, not during normal browsing.

export interface ReferenceData {
  securities: { uuid: string; name: string; isRetired: number }[];
  accounts: { uuid: string; name: string }[];
  secLogoMap: Map<string, string>;
  acctLogoMap: Map<string, string>;
}

let refCache: { data: ReferenceData; ts: number } | null = null;
const REF_CACHE_TTL = 60_000; // 60 seconds

export function getCachedReferenceData(sqlite: BetterSqlite3.Database): ReferenceData {
  const now = Date.now();
  if (refCache && now - refCache.ts < REF_CACHE_TTL) {
    return refCache.data;
  }

  const securities = sqlite
    .prepare('SELECT uuid, name, isRetired FROM security')
    .all() as { uuid: string; name: string; isRetired: number }[];

  const accounts = sqlite
    .prepare('SELECT uuid, name FROM account')
    .all() as { uuid: string; name: string }[];

  const secLogoRows = sqlite
    .prepare(`SELECT security AS uuid, value AS logoUrl FROM security_attr WHERE value LIKE 'data:image%'`)
    .all() as { uuid: string; logoUrl: string }[];

  const acctLogoRows = sqlite
    .prepare(`SELECT account AS uuid, value AS logoUrl FROM account_attr WHERE attr_uuid = 'logo'`)
    .all() as { uuid: string; logoUrl: string }[];

  const secLogoMap = new Map<string, string>(secLogoRows.map((r) => [r.uuid, r.logoUrl]));
  const acctLogoMap = new Map<string, string>(acctLogoRows.map((r) => [r.uuid, r.logoUrl]));

  const data: ReferenceData = { securities, accounts, secLogoMap, acctLogoMap };
  refCache = { data, ts: now };
  return data;
}

/** Clear all module-level caches. Used by tests to avoid cross-test pollution. */
export function clearCaches() {
  statementCache = null;
  refCache = null;
}
