import { useMemo } from 'react';
import { useTheme } from './use-theme';

function getCssVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function useChartColors() {
  const { resolvedTheme } = useTheme();
  return useMemo(() => {
    const isDark = resolvedTheme === 'dark';

    // Read semantic colors from CSS vars (theme-aware)
    const profit   = getCssVar('--qv-success')  || (isDark ? '#99d52a' : '#66800b');
    const loss     = getCssVar('--qv-danger')   || (isDark ? '#d14d41' : '#af3029');
    const warning  = getCssVar('--qv-warning')  || (isDark ? '#d0a215' : '#ad8301');
    const success  = profit;
    const danger   = loss;
    const dividend = getCssVar('--color-chart-1') || '#4385BE';
    const interest = getCssVar('--color-chart-5') || '#8B7EC8';
    const cyan     = getCssVar('--color-primary') || 'hsl(225,25%,48%)';
    const violet   = interest;

    // Build palette from CSS vars
    const fallbacks = [
      '#4385BE', '#3AA99F', '#DA702C', '#D14D41',
      '#8B7EC8', '#879A39', '#D0A215', '#CE5D97',
    ];
    const palette = Array.from({ length: 8 }, (_, i) =>
      getCssVar(`--color-chart-${i + 1}`) || fallbacks[i],
    );

    return { cyan, violet, success, danger, warning, profit, loss, dividend, interest, palette, isDark };
  }, [resolvedTheme]);
}
