import { useState, useEffect, useRef } from 'react';

/**
 * Animates a number from 0 to the target value.
 * Returns the current animated value.
 *
 * @param target  The final value to count up to
 * @param duration Animation duration in ms (default 600)
 * @param enabled Whether the animation should run (default true)
 */
export function useCountUp(target: number, duration = 600, enabled = true): number {
  const [current, setCurrent] = useState(enabled ? 0 : target);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (!enabled) {
      setCurrent(target);
      return;
    }

    // Skip animation for zero or same value
    if (target === 0 || target === prevTarget.current) {
      setCurrent(target);
      prevTarget.current = target;
      return;
    }

    prevTarget.current = target;
    startRef.current = null;

    function step(timestamp: number) {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for a natural deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(target * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setCurrent(target);
      }
    }

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, enabled]);

  return current;
}
