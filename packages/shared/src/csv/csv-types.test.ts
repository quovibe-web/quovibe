import { describe, it, expect } from 'vitest';
import { tradeColumnFields, csvErrorCodes } from './csv-types';

describe('tradeColumnFields — BUG-126 per-row account columns', () => {
  it('includes 4 new per-row account field keys', () => {
    expect(tradeColumnFields).toContain('account');
    expect(tradeColumnFields).toContain('securitiesAccount');
    expect(tradeColumnFields).toContain('offsetAccount');
    expect(tradeColumnFields).toContain('offsetSecuritiesAccount');
  });
});

describe('csvErrorCodes — BUG-126 per-row account errors', () => {
  it('includes 4 new account-class error codes', () => {
    expect(csvErrorCodes).toContain('INVALID_ACCOUNT_NAME');
    expect(csvErrorCodes).toContain('AMBIGUOUS_ACCOUNT_NAME');
    expect(csvErrorCodes).toContain('WRONG_ACCOUNT_TYPE');
    expect(csvErrorCodes).toContain('MISSING_ACCOUNT');
  });
});
