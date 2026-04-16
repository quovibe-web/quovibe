import { useRef, useEffect, useState } from 'react';
import { createChart, type IChartApi, type DeepPartial, type ChartOptions } from 'lightweight-charts';
import { useTheme } from '@/hooks/use-theme';
import { useChartTheme, toLightweightTheme } from '@/hooks/use-chart-theme';

/** Map chart instances to their ResizeObserver for cleanup — avoids mutating the library object */
// quovibe:allow-module-state — DOM observer registry keyed by chart instance; portfolio-agnostic DOM cleanup (ADR-016).
const chartResizeObservers = new WeakMap<IChartApi, ResizeObserver>();

interface UseLightweightChartOptions {
  options?: DeepPartial<ChartOptions>;
  autoResize?: boolean;
}

interface UseLightweightChartReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.MutableRefObject<IChartApi | null>;
  /** Increments when the chart is created. Use as effect dependency to react to chart readiness. */
  ready: number;
}

export function useLightweightChart(
  opts: UseLightweightChartOptions = {},
): UseLightweightChartReturn {
  const { options, autoResize = true } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [ready, setReady] = useState(0);
  const { resolvedTheme } = useTheme();
  const chartTheme = useChartTheme();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Poll for container availability — handles deferred rendering (isLoading guards)
  useEffect(() => {
    // If chart already exists, nothing to do
    if (chartRef.current) return;

    let cancelled = false;
    let observer: MutationObserver | undefined;

    function tryCreate() {
      const container = containerRef.current;
      if (!container || cancelled) return false;
      if (container.clientWidth === 0 || container.clientHeight === 0) return false; // native-ok

      const themeOptions = toLightweightTheme(chartTheme);
      const chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        ...themeOptions,
        ...optionsRef.current,
      });
      chartRef.current = chart;

      // Auto-resize
      if (autoResize) {
        const resizeObs = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry && chartRef.current) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) chartRef.current.resize(width, height); // native-ok
          }
        });
        resizeObs.observe(container);
        // Store for cleanup
        chartResizeObservers.set(chart, resizeObs);
      }

      setReady((v) => v + 1); // native-ok
      return true;
    }

    // Try immediately
    if (tryCreate()) return;

    // Otherwise wait for DOM changes (container might appear after loading state resolves)
    let retries = 0; // native-ok
    const MAX_RETRIES = 50; // native-ok — 50 × 100ms = 5s
    const interval = setInterval(() => { // native-ok
      if (tryCreate()) {
        clearInterval(interval); // native-ok
        observer?.disconnect();
      } else if (++retries >= MAX_RETRIES) { // native-ok
        clearInterval(interval); // native-ok
      }
    }, 100); // native-ok

    return () => {
      cancelled = true;
      clearInterval(interval); // native-ok
      observer?.disconnect();
    };
  }, [autoResize, chartTheme]); // re-run if theme changes before chart is created

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        const obs = chartResizeObservers.get(chartRef.current);
        obs?.disconnect();
        try { chartRef.current.remove(); } catch { /* chart already destroyed (HMR) */ }
        chartRef.current = null;
      }
    };
  }, []);

  // Apply theme changes to existing chart
  useEffect(() => {
    if (!chartRef.current) return;
    const themeOptions = toLightweightTheme(chartTheme);
    chartRef.current.applyOptions(themeOptions);
  }, [resolvedTheme, chartTheme]);

  return { containerRef, chartRef, ready };
}
