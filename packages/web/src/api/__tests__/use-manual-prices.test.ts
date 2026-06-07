import { describe, it, expect } from 'vitest';
import { manualPricesKey, buildDeleteBody } from '../use-manual-prices';

describe('manualPricesKey', () => {
  it('is hierarchical under the security prices key', () => {
    expect(manualPricesKey('pid-1', 'sec-1')).toEqual(['portfolios', 'pid-1', 'securities', 'sec-1', 'prices', 'raw']);
  });
});

describe('buildDeleteBody', () => {
  it('returns an explicit dates array', () => {
    expect(buildDeleteBody(['2025-01-01'])).toEqual({ dates: ['2025-01-01'] });
  });
  it('returns an empty object for delete-all', () => {
    expect(buildDeleteBody(undefined)).toEqual({});
  });
  it('returns an empty object for an empty array (delete-all)', () => {
    expect(buildDeleteBody([])).toEqual({});
  });
});
