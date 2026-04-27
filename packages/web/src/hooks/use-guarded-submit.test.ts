// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGuardedSubmit } from './use-guarded-submit';

describe('useGuardedSubmit', () => {
  it('coalesces N concurrent calls into a single handler invocation', async () => {
    let resolveHandler: () => void = () => {};
    const handlerPromise = new Promise<void>((r) => { resolveHandler = r; });
    const handler = vi.fn<[], Promise<void>>(() => handlerPromise);

    const { result } = renderHook(() => useGuardedSubmit(handler));

    let promises: Promise<void>[] = [];
    act(() => {
      promises = [
        result.current.run(),
        result.current.run(),
        result.current.run(),
        result.current.run(),
        result.current.run(),
      ];
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.current.inFlight).toBe(true);

    await act(async () => {
      resolveHandler();
      // The coalesced calls (promises[1..4]) must resolve cleanly, not reject:
      // the contract says re-entry is a silent no-op, not an error path. If
      // any of them rejects, Promise.all surfaces it and the test fails.
      await Promise.all(promises);
    });

    expect(result.current.inFlight).toBe(false);
  });

  it('allows sequential calls after the previous run settles', async () => {
    const handler = vi.fn<[], Promise<void>>(async () => {});

    const { result } = renderHook(() => useGuardedSubmit(handler));

    await act(async () => {
      await result.current.run();
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.current.inFlight).toBe(false);

    await act(async () => {
      await result.current.run();
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.current.inFlight).toBe(false);
  });

  it('rethrows handler errors and resets inFlight in finally', async () => {
    const handler = vi.fn<[], Promise<void>>(async () => {
      throw new Error('boom');
    });

    const { result } = renderHook(() => useGuardedSubmit(handler));

    await act(async () => {
      await expect(result.current.run()).rejects.toThrow('boom');
    });

    expect(result.current.inFlight).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not setState after unmount', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let resolveHandler: () => void = () => {};
    const handlerPromise = new Promise<void>((r) => { resolveHandler = r; });
    const handler = vi.fn<[], Promise<void>>(() => handlerPromise);

    const { result, unmount } = renderHook(() => useGuardedSubmit(handler));

    let runPromise: Promise<void> = Promise.resolve();
    act(() => {
      runPromise = result.current.run();
    });

    unmount();

    await act(async () => {
      resolveHandler();
      await runPromise;
    });

    // Heuristic: search console.error for "unmounted" — React's standard
    // setState-on-unmounted warning. Fragile to React version changes (the
    // exact warning text has shifted across React 16/17/18/19); if a future
    // upgrade renames the warning, this assertion silently passes a regression.
    // Watch for this when bumping React major versions.
    const unmountedSetStateLog = errorSpy.mock.calls.find((args) =>
      String(args[0]).includes('unmounted'),
    );
    expect(unmountedSetStateLog).toBeUndefined();

    errorSpy.mockRestore();
  });
});
