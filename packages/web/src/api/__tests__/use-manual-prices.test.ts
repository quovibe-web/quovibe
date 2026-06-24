import { describe, it, expect } from 'vitest';
import { manualPricesKey } from '../use-manual-prices';

describe('manualPricesKey', () => {
  it('is hierarchical under the security prices key', () => {
    expect(manualPricesKey('pid-1', 'sec-1')).toEqual(['portfolios', 'pid-1', 'securities', 'sec-1', 'prices', 'raw']);
  });
});
