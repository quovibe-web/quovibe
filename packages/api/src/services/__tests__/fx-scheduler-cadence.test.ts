import { describe, test, expect } from 'vitest';
import { msUntilNextRefresh, SIX_HOURS_MS } from '../fx-scheduler.service';

describe('msUntilNextRefresh', () => {
  test('returns positive value before 17 CET on a weekday', () => {
    // 2026-05-04 12:00 UTC = 14:00 CEST
    const now = new Date('2026-05-04T12:00:00Z').getTime();
    const ms = msUntilNextRefresh(now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(SIX_HOURS_MS);
  });

  test('caps at 6h when next 17 CET is far away (early morning)', () => {
    // 2026-05-04 04:00 UTC = 06:00 CEST. 17 CEST = 11h away → cap to 6h.
    const now = new Date('2026-05-04T04:00:00Z').getTime();
    expect(msUntilNextRefresh(now)).toBe(SIX_HOURS_MS);
  });

  test('targets next 17 CET when within 6h window', () => {
    // 2026-05-04 14:00 UTC = 16:00 CEST. 17 CEST in 1h → ms ≈ 3_600_000.
    const now = new Date('2026-05-04T14:00:00Z').getTime();
    const ms = msUntilNextRefresh(now);
    expect(ms).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(ms).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  test('rolls over to next-day 17 CET when after 17 CET, capped at 6h', () => {
    // 2026-05-04 16:00 UTC = 18:00 CEST. Next 17 CEST = ~23h. Cap to 6h.
    const now = new Date('2026-05-04T16:00:00Z').getTime();
    expect(msUntilNextRefresh(now)).toBe(SIX_HOURS_MS);
  });

  test('handles winter CET correctly (no DST)', () => {
    // 2026-01-15 14:30 UTC = 15:30 CET. 17 CET in 1.5h.
    const now = new Date('2026-01-15T14:30:00Z').getTime();
    const ms = msUntilNextRefresh(now);
    expect(ms).toBeGreaterThanOrEqual(90 * 60 * 1000 - 1000);
    expect(ms).toBeLessThanOrEqual(90 * 60 * 1000 + 1000);
  });
});
