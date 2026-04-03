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
    const profit   = getCssVar('--qv-success')  || (isDark ? '#34d399' : '#059669');
    const loss     = getCssVar('--qv-danger')   || (isDark ? '#fb7185' : '#dc2626');
    const warning  = getCssVar('--qv-warning')  || (isDark ? '#fbbf24' : '#b86e00');
    const success  = profit;
    const danger   = loss;
    const dividend = getCssVar('--color-chart-1') || (isDark ? 'hsl(220,33%,60%)' : 'hsl(220,28%,52%)');
    const interest = getCssVar('--color-chart-5') || (isDark ? 'hsl(245,30%,64%)' : 'hsl(245,25%,56%)');
    const cyan     = getCssVar('--color-primary') || (isDark ? 'hsl(225,30%,52%)' : 'hsl(225,32%,46%)');
    const violet   = interest;

    // Build palette from CSS vars
    const fallbacks = [
      'hsl(220,28%,52%)', 'hsl(175,25%,48%)', 'hsl(35,30%,52%)', 'hsl(350,25%,52%)',
      'hsl(245,25%,56%)', 'hsl(155,22%,48%)', 'hsl(25,30%,52%)', 'hsl(195,28%,48%)',
    ];
    const palette = Array.from({ length: 8 }, (_, i) =>
      getCssVar(`--color-chart-${i + 1}`) || fallbacks[i],
    );

    return { cyan, violet, success, danger, warning, profit, loss, dividend, interest, palette, isDark };
  }, [resolvedTheme]);
}
