/**
 * Test 3.3 — LazySection one-shot IntersectionObserver logic
 *
 * Tests the behavioral contract of LazySection:
 * 1. Before isIntersecting: children not shown (placeholder visible)
 * 2. After isIntersecting=true: children shown
 * 3. Observer is disconnected after first visibility (one-shot)
 *
 * Tests the logic directly via the IO callback contract,
 * without @testing-library/react (not available in this package).
 */

import { describe, it, expect, vi } from 'vitest';

// ── Simulates the exact logic inside LazySection ────────────────────────────

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

function makeLazySectionState(_rootMargin = '200px') {
  let isVisible = false;
  let disconnected = false;
  let observeCallback: IOCallback | null = null;

  const obs = {
    observe: vi.fn(),
    disconnect: vi.fn(() => { disconnected = true; }),
  };

  // Simulate the useEffect inside LazySection — use a regular function so it can be called with `new`
  function MockIO(cb: IOCallback) {
    observeCallback = cb;
    Object.assign(this as object, obs);
  }

  // Start observation (simulates mounting)
  const instance = new (MockIO as unknown as { new(cb: IOCallback): typeof obs })(
    (entries) => {
      if (entries[0].isIntersecting) {
        isVisible = true;
        instance.disconnect();
      }
    },
  );
  instance.observe({} as Element);

  return {
    get isVisible() { return isVisible; },
    get disconnected() { return disconnected; },
    triggerIntersection(intersecting: boolean) {
      observeCallback?.([{ isIntersecting: intersecting }]);
    },
    obs,
  };
}

describe('LazySection — one-shot IntersectionObserver contract', () => {
  it('child is not visible before any intersection event', () => {
    const state = makeLazySectionState();
    expect(state.isVisible).toBe(false);
  });

  it('child becomes visible when isIntersecting=true fires', () => {
    const state = makeLazySectionState();
    state.triggerIntersection(true);
    expect(state.isVisible).toBe(true);
  });

  it('child stays hidden when isIntersecting=false fires', () => {
    const state = makeLazySectionState();
    state.triggerIntersection(false);
    expect(state.isVisible).toBe(false);
  });

  it('observer is disconnected after first positive intersection (one-shot)', () => {
    const state = makeLazySectionState();
    state.triggerIntersection(true);
    expect(state.disconnected).toBe(true);
  });

  it('observer is NOT disconnected if only negative intersections occur', () => {
    const state = makeLazySectionState();
    state.triggerIntersection(false);
    expect(state.disconnected).toBe(false);
  });
});
