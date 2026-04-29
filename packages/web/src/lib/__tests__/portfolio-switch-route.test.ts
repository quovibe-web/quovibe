import { describe, it, expect } from 'vitest';
import { portfolioSectionPath } from '../portfolio-switch-route';

describe('portfolioSectionPath', () => {
  it('preserves top-level sections', () => {
    expect(portfolioSectionPath('/p/A/dashboard')).toBe('/dashboard');
    expect(portfolioSectionPath('/p/A/investments')).toBe('/investments');
    expect(portfolioSectionPath('/p/A/transactions')).toBe('/transactions');
    expect(portfolioSectionPath('/p/A/accounts')).toBe('/accounts');
    expect(portfolioSectionPath('/p/A/watchlists')).toBe('/watchlists');
    expect(portfolioSectionPath('/p/A/allocation')).toBe('/allocation');
  });

  it('drops portfolio-scoped resource IDs', () => {
    expect(portfolioSectionPath('/p/A/dashboard/DASH_ID')).toBe('/dashboard');
    expect(portfolioSectionPath('/p/A/investments/SEC_ID')).toBe('/investments');
    expect(portfolioSectionPath('/p/A/accounts/ACC_ID')).toBe('/accounts');
  });

  it('drops /transactions/new so a new-transaction form does not follow the switch', () => {
    expect(portfolioSectionPath('/p/A/transactions/new')).toBe('/transactions');
  });

  it('preserves the analytics sub-tab when valid', () => {
    expect(portfolioSectionPath('/p/A/analytics/calculation')).toBe('/analytics/calculation');
    expect(portfolioSectionPath('/p/A/analytics/chart')).toBe('/analytics/chart');
    expect(portfolioSectionPath('/p/A/analytics/income')).toBe('/analytics/income');
  });

  it('falls back to analytics/calculation for bare or unknown analytics paths', () => {
    expect(portfolioSectionPath('/p/A/analytics')).toBe('/analytics/calculation');
    expect(portfolioSectionPath('/p/A/analytics/bogus')).toBe('/analytics/calculation');
  });

  it('canonicalizes settings, taxonomies and import to their only real subpath', () => {
    expect(portfolioSectionPath('/p/A/settings/data')).toBe('/settings/data');
    expect(portfolioSectionPath('/p/A/settings')).toBe('/settings/data');
    expect(portfolioSectionPath('/p/A/taxonomies/data-series')).toBe('/taxonomies/data-series');
    expect(portfolioSectionPath('/p/A/import/csv')).toBe('/import/csv');
  });

  it('defaults unknown paths (legacy aliases, bare root) to /dashboard', () => {
    expect(portfolioSectionPath('/p/A')).toBe('/dashboard');
    expect(portfolioSectionPath('/p/A/')).toBe('/dashboard');
    expect(portfolioSectionPath('/p/A/performance')).toBe('/dashboard');
    expect(portfolioSectionPath('/p/A/reports/payments')).toBe('/dashboard');
    expect(portfolioSectionPath('/p/A/securities/SEC_ID')).toBe('/dashboard');
  });

  it('returns /dashboard for user-scope paths without a /p/<id>/ prefix', () => {
    expect(portfolioSectionPath('/settings')).toBe('/dashboard');
    expect(portfolioSectionPath('/welcome')).toBe('/dashboard');
    expect(portfolioSectionPath('/import')).toBe('/dashboard');
    expect(portfolioSectionPath('/')).toBe('/dashboard');
  });

  it('tolerates UUID-shaped portfolio IDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(portfolioSectionPath(`/p/${uuid}/investments/X`)).toBe('/investments');
  });
});
