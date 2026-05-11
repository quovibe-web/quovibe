import { describe, it, expect } from 'vitest';
import { ApiError } from '@/api/fetch';
import { extractServerFieldErrors } from '../transaction-server-error';

// Pure helper — rendered behaviour belongs to manual Playwright per QA
// convention. The web vitest setup runs in node-env (no DOM library).
describe('extractServerFieldErrors', () => {
  it('returns [] for null / undefined / non-ApiError inputs', () => {
    expect(extractServerFieldErrors(null)).toEqual([]);
    expect(extractServerFieldErrors(undefined)).toEqual([]);
    expect(extractServerFieldErrors('boom')).toEqual([]);
    expect(extractServerFieldErrors(42)).toEqual([]);
    expect(extractServerFieldErrors(new Error('plain'))).toEqual([]);
  });

  it('parses a Zod-shaped ApiError into per-field errors', () => {
    // Wire body: {error:'Validation error', details:[…]} → apiFetch packs
    // rest-of-body into ApiError.details, landing the Zod issues at
    // apiError.details.details.
    const err = new ApiError(400, 'Validation error', {
      details: [
        { code: 'invalid_type', expected: 'string', path: ['accountId'], message: 'Required' },
        { code: 'custom', path: ['fxRate'], message: 'fxRate required when source/destination currencies differ' },
      ],
    });
    expect(extractServerFieldErrors(err)).toEqual([
      { field: 'accountId', message: 'Required' },
      { field: 'fxRate', message: 'fxRate required when source/destination currencies differ' },
    ]);
  });

  it('drops issues whose path head is not a known form field', () => {
    const err = new ApiError(400, 'Validation error', {
      details: [
        { path: ['mysteryField'], message: 'nope' },
        { path: ['shares'], message: 'must be > 0' },
      ],
    });
    expect(extractServerFieldErrors(err)).toEqual([
      { field: 'shares', message: 'must be > 0' },
    ]);
  });

  it('drops issues with empty path or non-string head or empty message', () => {
    const err = new ApiError(400, 'Validation error', {
      details: [
        { path: [], message: 'no path' },
        { path: [42, 'amount'], message: 'numeric head' },
        { path: ['amount'], message: '' },
        { path: ['amount'] },
      ],
    });
    expect(extractServerFieldErrors(err)).toEqual([]);
  });

  it('maps FX_RATE_REQUIRED (route-layer 400, no details) onto the fxRate field', () => {
    expect(extractServerFieldErrors(new ApiError(400, 'FX_RATE_REQUIRED', {}))).toEqual([
      { field: 'fxRate', message: 'FX_RATE_REQUIRED' },
    ]);
  });

  it('returns [] for wire codes outside the non-field allowlist', () => {
    expect(extractServerFieldErrors(new ApiError(422, 'TRANSACTION_TYPE_NOT_ALLOWED_FOR_SOURCE', {}))).toEqual([]);
    expect(extractServerFieldErrors(new ApiError(500, 'INTERNAL_ERROR', {}))).toEqual([]);
  });

  it('drops the type field even if a server issue points at it', () => {
    const err = new ApiError(400, 'Validation error', {
      details: [{ path: ['type'], message: 'invalid' }],
    });
    expect(extractServerFieldErrors(err)).toEqual([]);
  });
});
