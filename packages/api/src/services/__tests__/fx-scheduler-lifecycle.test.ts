import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import {
  startFxScheduler,
  stopFxScheduler,
  _schedulerStateForTests,
  _resetEagerForTests,
} from '../fx-scheduler.service';

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
  _resetEagerForTests();
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

  test('eager-fires fetchAllExchangeRates once on first start (PP startup parity)', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);
    // Eager fetch is scheduled via Promise.resolve().then(...). Flush microtasks.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(1);
    expect(fetchAllExchangeRates).toHaveBeenCalledWith(sqlite);
  });

  test('eager fires once per portfolio per process (re-acquire after evict skips eager)', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(1); // eager fired

    stopFxScheduler('p1');                                  // simulate pool eviction
    startFxScheduler('p1', sqlite);                         // simulate cache-miss reopen
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(1); // eager NOT re-fired
  });

  test('fires fetchAllExchangeRates again after timer elapses', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);

    // Advance 6h+1ms to guarantee the next-refresh window has elapsed.
    // Eager (1) + tick (1) = 2 calls.
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);

    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(2);
    expect(fetchAllExchangeRates).toHaveBeenLastCalledWith(sqlite);
  });

  test('re-arms after each tick', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(2); // eager + 1 tick
    expect(_schedulerStateForTests().size).toBe(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(3); // eager + 2 ticks
  });
});

describe('stopFxScheduler', () => {
  test('clears the timer (eager already in-flight is harmless)', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    startFxScheduler('p1', sqlite);
    stopFxScheduler('p1');
    expect(_schedulerStateForTests().size).toBe(0);

    // Eager fired once (microtask flushes during advance); tick was cancelled.
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1);
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(1);
  });

  test('is a no-op for unknown id', () => {
    expect(() => stopFxScheduler('never-started')).not.toThrow();
  });

  test('stop+restart during in-flight tick fetch does not clobber the new timer', async () => {
    const { fetchAllExchangeRates } = await import('../fx-fetcher.service');
    let resolveFetch: () => void = () => {};
    let callCount = 0;
    // Eager (call 1) and tick_B (call 3) resolve immediately; tick_A (call 2) hangs in-flight.
    vi.mocked(fetchAllExchangeRates).mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return new Promise<{ results: never[]; totalFetched: number; duration: number }>((r) => {
          resolveFetch = () => r({ results: [], totalFetched: 0, duration: 0 });
        });
      }
      return Promise.resolve({ results: [], totalFetched: 0, duration: 0 });
    });

    startFxScheduler('p1', sqlite);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1); // eager + tick_A fire (tick_A in-flight)

    stopFxScheduler('p1');
    startFxScheduler('p1', sqlite); // new timer self_B installed; Set guard skips eager re-fire

    const sizeAfterRestart = _schedulerStateForTests().size;
    resolveFetch(); // tick_A's .finally runs: ownership guard MUST detect self_B and skip re-arm
    await vi.runOnlyPendingTimersAsync();

    // Guard intact: eager(1) + tick_A(2) + tick_B(3) = 3.
    // Guard removed: tick_A.finally clobbers self_B with self_A2; both fire = 4.
    expect(fetchAllExchangeRates).toHaveBeenCalledTimes(3);
    expect(_schedulerStateForTests().size).toBe(sizeAfterRestart);
  });
});
