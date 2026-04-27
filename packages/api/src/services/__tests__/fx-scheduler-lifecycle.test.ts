import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { startFxScheduler, stopFxScheduler, _schedulerStateForTests } from '../fx-scheduler.service';

vi.mock('../fx-fetcher.service', () => ({
  fetchAllExchangeRates: vi.fn().mockResolvedValue({ results: [], totalFetched: 0, duration: 0 }),
}));

vi.mock('../portfolio-registry', () => ({
  getPortfolioEntry: vi.fn((id: string) => (id === 'demo' ? { kind: 'demo', id, name: 'Demo' } : { kind: 'real', id, name: id })),
}));

let sqlite: BetterSqlite3.Database;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sqlite = new Database(':memory:');
  // Clear scheduler state between tests.
  for (const id of _schedulerStateForTests().ids) stopFxScheduler(id);
});

afterEach(() => {
  for (const id of _schedulerStateForTests().ids) stopFxScheduler(id);
  vi.useRealTimers();
  sqlite.close();
});

describe('startFxScheduler', () => {
  test('arms a timer entry for the portfolio', () => {
    startFxScheduler('p1', sqlite);
    expect(_schedulerStateForTests().ids).toEqual(['p1']);
  });

  test('demo portfolios are skipped', () => {
    startFxScheduler('demo', sqlite);
    expect(_schedulerStateForTests().size).toBe(0);
  });

  test('re-entrant start replaces prior timer (no leak)', () => {
    startFxScheduler('p1', sqlite);
    startFxScheduler('p1', sqlite);
    expect(_schedulerStateForTests().size).toBe(1);
  });

  test('fires fetchAllExchangeRates after timer elapses', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);
    expect(fetchAllExchangeRates).not.toHaveBeenCalled();

    // Advance 6h+1ms to guarantee the next-refresh window has elapsed.
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);

    expect(fetchAllExchangeRates).toHaveBeenCalledWith(sqlite);
  });

  test('re-arms after each fire', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(1);
    expect(_schedulerStateForTests().size).toBe(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(2);
  });
});

describe('stopFxScheduler', () => {
  test('clears the timer', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);
    stopFxScheduler('p1');
    expect(_schedulerStateForTests().size).toBe(0);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);
    expect(fetchAllExchangeRates).not.toHaveBeenCalled();
  });

  test('is a no-op for unknown id', () => {
    expect(() => stopFxScheduler('never-started')).not.toThrow();
  });

  test('stop+restart during in-flight fetch does not clobber the new timer', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    let resolveFetch: () => void = () => {};
    (fetchAllExchangeRates as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<{ results: never[]; totalFetched: number; duration: number }>((r) => {
        resolveFetch = () => r({ results: [], totalFetched: 0, duration: 0 });
      }),
    );

    startFxScheduler('p1', sqlite);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1); // first tick fires, fetch in flight

    stopFxScheduler('p1');
    startFxScheduler('p1', sqlite); // new timer installed BEFORE the in-flight fetch resolves

    const sizeAfterRestart = _schedulerStateForTests().size;
    resolveFetch(); // unblock the in-flight fetch; its .finally must NOT clobber the new timer
    await vi.runOnlyPendingTimersAsync();

    // The post-resolve state should still be exactly 1 entry — the old tick's
    // re-arm must have been suppressed by the identity check.
    expect(_schedulerStateForTests().size).toBe(sizeAfterRestart);
  });
});
