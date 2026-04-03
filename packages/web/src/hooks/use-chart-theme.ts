import { useMemo } from 'react';
import { useTheme } from './use-theme';

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
