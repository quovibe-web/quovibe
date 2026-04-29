// packages/api/src/services/__tests__/fx-scheduler-wiring.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { wireFxScheduler } from '../fx-scheduler.service';
import { setOnOpened, setOnEvicted } from '../portfolio-db-pool';

vi.mock(import('../portfolio-db-pool'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setOnOpened: vi.fn(),
    setOnEvicted: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wireFxScheduler', () => {
  test('registers both hooks', () => {
    wireFxScheduler();
    expect(setOnOpened).toHaveBeenCalledTimes(1);
    expect(setOnEvicted).toHaveBeenCalledTimes(1);
  });
});
