import { useRef, useEffect, useCallback, useState } from 'react';
import { createChart, type IChartApi, type DeepPartial, type ChartOptions } from 'lightweight-charts';
import { useTheme } from '@/hooks/use-theme';
import { useChartTheme, toLightweightTheme } from '@/hooks/use-chart-theme';

interface UseLightweightChartOptions {
  options?: DeepPartial<ChartOptions>;
  autoResize?: boolean;
}

interface UseLightweightChartReturn {
  containerRef: (node: HTMLDivElement | null) => void;
  chartRef: React.MutableRefObject<IChartApi | null>;
  /** True once the chart has been created (container mounted in DOM). Use as effect dependency. */
  ready: boolean;
}

export function useLightweightChart(
  opts: UseLightweightChartOptions = {},
): UseLightweightChartReturn {
  const { options, autoResize = true } = opts;
  const chartRef = useRef<IChartApi | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const chartTheme = useChartTheme();

  // Ref callback: fires when the container div mounts/unmounts in the DOM
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous chart if container changes
    if (containerNodeRef.current && containerNodeRef.current !== node) {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    }
    containerNodeRef.current = node;

    if (!node) {
      setMounted(false);
      return;
    }

    // Create chart
    const themeOptions = toLightweightTheme(chartTheme);
    const chart = createChart(node, {
      width: node.clientWidth,
      height: node.clientHeight,
      ...themeOptions,
      ...options,
    });
    chartRef.current = chart;

    // Auto-resize observer
    if (autoResize) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && chartRef.current) {
          const { width, height } = entry.contentRect;
          chartRef.current.resize(width, height);
        }
      });
      observer.observe(node);
      observerRef.current = observer;
    }

    setMounted(true);
  }, []); // stable callback — options/theme applied separately

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Apply theme changes
  useEffect(() => {
    if (!chartRef.current) return;
    const themeOptions = toLightweightTheme(chartTheme);
    chartRef.current.applyOptions(themeOptions);
  }, [resolvedTheme, chartTheme, mounted]);

  return { containerRef, chartRef, ready: mounted };
}
