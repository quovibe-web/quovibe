import type BetterSqlite3 from 'better-sqlite3';
import type { DataSeriesValue } from '@quovibe/shared';

export interface ResolvedParams {
  filter?: string;
  withReference?: boolean;
  preTax?: boolean;
  taxonomyId?: string;
  categoryId?: string;
}

export class DataSeriesNotFoundError extends Error {
  status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'DataSeriesNotFoundError';
  }
}

export function resolveDataSeries(
  db: BetterSqlite3.Database,
  value: DataSeriesValue,
): ResolvedParams {
  switch (value.type) {
    case 'portfolio':
      return { preTax: value.preTax };
    case 'account': {
      const row = db.prepare(
        `SELECT uuid FROM account WHERE uuid = ? AND type = 'portfolio' AND (isRetired = 0 OR isRetired IS NULL)`
      ).get(value.accountId) as { uuid: string } | undefined;
      if (!row) throw new DataSeriesNotFoundError('Account not found');
      return { filter: value.accountId, withReference: value.withReference };
    }
    case 'taxonomy': {
      const row = db.prepare(
        `SELECT uuid FROM taxonomy WHERE uuid = ?`
      ).get(value.taxonomyId) as { uuid: string } | undefined;
      if (!row) throw new DataSeriesNotFoundError('Taxonomy not found');
      return {
        taxonomyId: value.taxonomyId,
        ...(value.categoryId ? { categoryId: value.categoryId } : {}),
      };
    }
    case 'security': {
      const row = db.prepare(
        `SELECT uuid FROM security WHERE uuid = ?`
      ).get(value.securityId) as { uuid: string } | undefined;
      if (!row) throw new DataSeriesNotFoundError('Security not found');
      return { filter: value.securityId };
    }
  }
}

export function resolveDataSeriesLabel(
  db: BetterSqlite3.Database,
  value: DataSeriesValue,
): string {
  switch (value.type) {
    case 'portfolio':
      return 'Entire portfolio';
    case 'account': {
      if (value.withReference) {
        const row = db.prepare(`
          SELECT a.name AS accountName, ref.name AS refName
          FROM account a
          LEFT JOIN account ref ON a.referenceAccount = ref.uuid
          WHERE a.uuid = ?
        `).get(value.accountId) as { accountName: string; refName: string | null } | undefined;
        if (!row) throw new DataSeriesNotFoundError('Account not found');
        return row.refName ? `${row.accountName} + ${row.refName}` : row.accountName;
      }
      const row = db.prepare(`SELECT name FROM account WHERE uuid = ?`).get(value.accountId) as { name: string } | undefined;
      if (!row) throw new DataSeriesNotFoundError('Account not found');
      return row.name;
    }
    case 'taxonomy': {
      if (value.categoryId) {
        const row = db.prepare(`
          SELECT t.name AS taxName, c.name AS catName
          FROM taxonomy t
          JOIN taxonomy_category c ON c.uuid = ? AND c.taxonomy = t.uuid
          WHERE t.uuid = ?
        `).get(value.categoryId, value.taxonomyId) as { taxName: string; catName: string } | undefined;
        if (!row) throw new DataSeriesNotFoundError('Taxonomy not found');
        return `${row.taxName} › ${row.catName}`;
      }
      const row = db.prepare(`SELECT name FROM taxonomy WHERE uuid = ?`).get(value.taxonomyId) as { name: string } | undefined;
      if (!row) throw new DataSeriesNotFoundError('Taxonomy not found');
      return row.name;
    }
    case 'security': {
      const row = db.prepare(`SELECT name, tickerSymbol FROM security WHERE uuid = ?`).get(value.securityId) as { name: string; tickerSymbol: string | null } | undefined;
      if (!row) throw new DataSeriesNotFoundError('Security not found');
      return row.tickerSymbol ? `${row.name} (${row.tickerSymbol})` : row.name;
    }
  }
}
