import { useRef, useEffect } from 'react';
import { createChart, type IChartApi, type DeepPartial, type ChartOptions } from 'lightweight-charts';
import { useTheme } from '@/hooks/use-theme';
import { useChartTheme, toLightweightTheme } from '@/hooks/use-chart-theme';

interface UseLightweightChartOptions {
  options?: DeepPartial<ChartOptions>;
  autoResize?: boolean;
}

interface UseLightweightChartReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.MutableRefObject<IChartApi | null>;
}

export function useLightweightChart(
  opts: UseLightweightChartOptions = {},
): UseLightweightChartReturn {
  const { options, autoResize = true } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();
  const chartTheme = useChartTheme();

  // Create chart on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const themeOptions = toLightweightTheme(chartTheme);
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      ...themeOptions,
      ...options,
    });
    chartRef.current = chart;

    // Auto-resize observer
    let observer: ResizeObserver | undefined;
    if (autoResize) {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && chartRef.current) {
          const { width, height } = entry.contentRect;
          chartRef.current.resize(width, height);
        }
      });
      observer.observe(container);
    }

    return () => {
      observer?.disconnect();
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — theme changes handled separately

  // Apply theme changes
  useEffect(() => {
    if (!chartRef.current) return;
    const themeOptions = toLightweightTheme(chartTheme);
    chartRef.current.applyOptions(themeOptions);
  }, [resolvedTheme, chartTheme]);

  return { containerRef, chartRef };
}
