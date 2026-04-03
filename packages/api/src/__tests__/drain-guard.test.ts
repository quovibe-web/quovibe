import { describe, it, expect } from 'vitest';

// Test the waitForDrain logic in isolation (pure function)
function waitForDrain(getActiveRequests: () => number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (getActiveRequests() <= 0) return resolve();
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(() => {
      if (getActiveRequests() <= 0 || Date.now() >= deadline) {
        clearInterval(interval);
        resolve();
      }
    }, 10);
  });
}

describe('waitForDrain', () => {
  it('resolves immediately when no active requests', async () => {
    const start = Date.now();
    await waitForDrain(() => 0, 5000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('waits until active requests reach zero', async () => {
    let active = 3;
    setTimeout(() => { active = 0; }, 100);
    const start = Date.now();
    await waitForDrain(() => active, 5000);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(500);
  });

  it('resolves after timeout even if requests remain', async () => {
    const start = Date.now();
    await waitForDrain(() => 5, 200);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(500);
  });
});
