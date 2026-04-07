import { useMemo } from 'react';
import { useTheme } from './use-theme';
import type { DeepPartial, ChartOptions } from 'lightweight-charts';

interface ChartTheme {
  /** CartesianGrid stroke */
  gridColor: string;
  gridOpacity: number;
  /** Axis tick fill */
  tickColor: string;
  /** Tooltip cursor stroke */
  cursorColor: string;
  cursorDasharray: string;
  /** Resolved theme for any remaining conditional logic */
  isDark: boolean;
}

/** Map quovibe theme to Lightweight Charts options */
export function toLightweightTheme(theme: ChartTheme): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { color: 'transparent' },
      textColor: theme.tickColor,
      fontFamily: 'inherit',
    },
    grid: {
      vertLines: { color: theme.gridColor, style: 1 },
      horzLines: { color: theme.gridColor, style: 1 },
    },
    crosshair: {
      vertLine: { color: theme.cursorColor, labelBackgroundColor: theme.cursorColor },
      horzLine: { color: theme.cursorColor, labelBackgroundColor: theme.cursorColor },
    },
    timeScale: {
      borderColor: theme.gridColor,
      timeVisible: false,
    },
    rightPriceScale: {
      borderColor: theme.gridColor,
    },
    leftPriceScale: {
      borderColor: theme.gridColor,
    },
  };
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  return useMemo(() => ({
    gridColor: 'var(--qv-border)',
    gridOpacity: 0.5,
    tickColor: 'var(--qv-text-muted)',
    cursorColor: 'var(--qv-text-faint)',
    cursorDasharray: '4 4',
    isDark: resolvedTheme === 'dark',
  }), [resolvedTheme]);
}
