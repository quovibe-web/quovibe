import type { DataSeriesValue } from '@quovibe/shared';

export interface DataSeriesParams {
  preTax: boolean;
  filter?: string;
  withReference?: boolean;
  taxonomyId?: string;
  categoryId?: string;
}

export function resolveDataSeriesToParams(ds: DataSeriesValue | null): DataSeriesParams {
  if (!ds) return { preTax: false };

  switch (ds.type) {
    case 'portfolio':
      return { preTax: ds.preTax };
    case 'account':
      return { preTax: false, filter: ds.accountId, withReference: ds.withReference };
    case 'taxonomy':
      return { preTax: true, taxonomyId: ds.taxonomyId, categoryId: ds.categoryId };
    case 'security':
      return { preTax: false, filter: ds.securityId };
  }
}
