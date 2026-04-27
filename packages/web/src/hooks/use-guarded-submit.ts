import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wraps an async handler with a synchronous re-entry guard. The guard prevents
 * rapid double-clicks (or any same-tick re-entry) from invoking the handler
 * twice — the second call is a silent no-op while the first promise is in
 * flight.
 *
 * Contract:
 *  - `handler` MUST return a Promise that settles when the underlying side
 *    effect (POST/PUT/DELETE) settles. Wrapping a `mutate(...)` fire-and-forget
 *    call defeats the guard: the wrapper releases the same microtask, before
 *    the network round-trip resolves, and the second click slips through. Use
 *    `await mutateAsync(...)`.
 *  - Errors thrown by `handler` are re-thrown out of `run` so the caller's
 *    existing try/catch (or React Query's `onError`) keeps working.
 *  - The internal `useCallback` dep on `handler` means an inline arrow
 *    `async (v) => mutateAsync(v)` recreates `run` every render. Harmless
 *    for one-shot Save buttons; if you ever put `run` into a dep array,
 *    wrap the handler in `useCallback` at the call site.
 *  - `inFlight` is reactive React state suitable for the button `disabled`
 *    prop. The race-closing guard is the internal `useRef(false)`, not the
 *    React state.
 *
 * Rationale: BUG-145 (rapid-double-click duplicate POST on `TransactionForm`),
 * design doc at docs/superpowers/specs/2026-04-27-bug-145-shared-form-save-guard-design.md.
 */
export function useGuardedSubmit<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<void>,
): { run: (...args: TArgs) => Promise<void>; inFlight: boolean } {
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const [inFlight, setInFlight] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: TArgs) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setInFlight(true);
      try {
        await handler(...args);
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setInFlight(false);
      }
    },
    [handler],
  );

  return { run, inFlight };
}
