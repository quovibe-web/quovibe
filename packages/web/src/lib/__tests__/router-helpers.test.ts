import { describe, it, expect } from 'vitest';
import { appendSearch } from '../router-helpers';

describe('appendSearch', () => {
  it('returns target unchanged when search is empty', () => {
    expect(appendSearch('/p/123/analytics/chart', '')).toBe('/p/123/analytics/chart');
  });

  it('appends search to an absolute target', () => {
    expect(
      appendSearch('/p/123/analytics/chart', '?periodStart=2020-01-01&periodEnd=2024-12-31'),
    ).toBe('/p/123/analytics/chart?periodStart=2020-01-01&periodEnd=2024-12-31');
  });

  it('appends search to a relative target (../new)', () => {
    expect(appendSearch('../analytics/calculation', '?x=1')).toBe('../analytics/calculation?x=1');
  });

  it('appends search to an index target ("dashboard")', () => {
    expect(appendSearch('dashboard', '?periodStart=2020-01-01')).toBe('dashboard?periodStart=2020-01-01');
  });
});
