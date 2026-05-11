// Reads reference data (securities, accounts, logos) for a portfolio.
//
// Previously behind a module-scope TTL cache in statement-cache.ts that
// leaked across portfolios (keyed only by time, not by sqlite handle).
// Deletion + this pure read fixes ADR-015 compliance; profiling showed the
// cross-request TTL saved ~2 ms per call, below perceptible.
//
// If a future profiling pass demonstrates this read is a hotspot, wrap it
// in a `PortfolioCache<ReferenceData>` (see helpers/portfolio-cache.ts).

import type BetterSqlite3 from 'better-sqlite3';

export interface ReferenceData {
  securities: { uuid: string; name: string; isRetired: number }[];
  accounts: { uuid: string; name: string }[];
  secLogoMap: Map<string, string>;
  acctLogoMap: Map<string, string>;
}

export function getReferenceData(sqlite: BetterSqlite3.Database): ReferenceData {
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

  return { securities, accounts, secLogoMap, acctLogoMap };
}
