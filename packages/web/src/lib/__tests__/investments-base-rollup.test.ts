import { describe, it, expect } from 'vitest';
import { computeUnresolvedBadge } from '../investments-base-rollup';

describe('computeUnresolvedBadge', () => {
  it('returns null when count is 0', () => {
    expect(computeUnresolvedBadge(0, [])).toBeNull();
  });

  it('returns badge with count + ids when count > 0', () => {
    const badge = computeUnresolvedBadge(2, ['s1', 's2']);
    expect(badge).toEqual({
      severity: 'warning',
      messageKey: 'investments.unresolvedFx',
      count: 2,
      ids: ['s1', 's2'],
    });
  });

  it('returns badge with empty ids when count > 0 but ids unknown', () => {
    const badge = computeUnresolvedBadge(3, []);
    expect(badge?.count).toBe(3);
    expect(badge?.ids).toEqual([]);
  });
});
