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
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    rightPriceScale: {
      borderColor: theme.gridColor,
    },
    leftPriceScale: {
      borderColor: theme.gridColor,
    },
  };
}

/** Resolve a CSS variable to its computed value at runtime */
function resolveCssVar(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  return useMemo(() => {
    // Lightweight Charts renders on canvas — CSS variables don't work there.
    // Resolve them to actual color values.
    const border = resolveCssVar('--qv-border') || (resolvedTheme === 'dark' ? '#2a2a3a' : '#e5e7eb');
    const textMuted = resolveCssVar('--qv-text-muted') || (resolvedTheme === 'dark' ? '#a1a1b5' : '#6b7280');
    const textFaint = resolveCssVar('--qv-text-faint') || (resolvedTheme === 'dark' ? '#6b6b80' : '#9ca3af');

    return {
      gridColor: border,
      gridOpacity: 0.5,
      tickColor: textMuted,
      cursorColor: textFaint,
      cursorDasharray: '4 4',
      isDark: resolvedTheme === 'dark',
    };
  }, [resolvedTheme]);
}
