import { useMemo } from 'react';
import { useTheme } from './use-theme';
import { CrosshairMode, type DeepPartial, type ChartOptions } from 'lightweight-charts';
import { withAlpha } from '@/lib/chart-types';

interface ChartTheme {
  /** CartesianGrid stroke */
  gridColor: string;
  gridOpacity: number;
  /** Axis tick fill */
  tickColor: string;
  /** Tooltip cursor stroke */
  cursorColor: string;
  cursorDasharray: string;
  /** Crosshair label background — brand-accent, eye-catcher */
  labelBackgroundColor: string;
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
      // No grid lines — price-scale ticks + crosshair label + last-value badge
      // carry the value-reading job. Design-system §3.1 "dividers > backgrounds"
      // and §3.5 "empty space is content" — let the data line own the canvas.
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    crosshair: {
      // Explicit so a future library default flip doesn't silently change the feel.
      mode: CrosshairMode.Magnet,
      vertLine: { color: theme.cursorColor, labelBackgroundColor: theme.labelBackgroundColor },
      horzLine: { color: theme.cursorColor, labelBackgroundColor: theme.labelBackgroundColor },
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
    // Flexoki blue (light: #205EA6, dark: #4385BE) — see design-system-v1 §1.3.
    const primary = resolveCssVar('--color-primary') || (resolvedTheme === 'dark' ? '#4385BE' : '#205EA6');

    return {
      gridColor: withAlpha(border, 0.15),
      gridOpacity: 0.5,
      tickColor: textMuted,
      cursorColor: textFaint,
      cursorDasharray: '4 4',
      labelBackgroundColor: primary,
      isDark: resolvedTheme === 'dark',
    };
  }, [resolvedTheme]);
}
