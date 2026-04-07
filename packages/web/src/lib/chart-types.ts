export type ChartSeriesType = 'line' | 'area' | 'candlestick' | 'bar' | 'baseline' | 'histogram';

/** Available chart types based on data shape */
export const SINGLE_VALUE_TYPES: ChartSeriesType[] = ['line', 'area', 'baseline', 'histogram'];
export const OHLC_TYPES: ChartSeriesType[] = ['line', 'area', 'candlestick', 'bar', 'baseline', 'histogram'];

const STORAGE_PREFIX = 'qv-chart-type-';

/** Read saved chart type for a specific chart instance */
export function getSavedChartType(chartId: string): ChartSeriesType | null {
  const saved = localStorage.getItem(`${STORAGE_PREFIX}${chartId}`);
  if (saved && (SINGLE_VALUE_TYPES.includes(saved as ChartSeriesType) || OHLC_TYPES.includes(saved as ChartSeriesType))) {
    return saved as ChartSeriesType;
  }
  return null;
}

/** Save chart type preference for a specific chart instance */
export function saveChartType(chartId: string, type: ChartSeriesType): void {
  localStorage.setItem(`${STORAGE_PREFIX}${chartId}`, type);
}

/**
 * Apply alpha to any CSS color string (hex, hsl, rgb).
 * Canvas doesn't support appending hex alpha to HSL strings.
 * @param color - Any valid CSS color
 * @param alpha - Opacity 0-1
 */
export function withAlpha(color: string, alpha: number): string {
  // hex: #rrggbb or #rgb
  if (color.startsWith('#')) {
    const hex = color.length === 4 // native-ok
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` // native-ok
      : color.slice(0, 7); // native-ok
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0'); // native-ok
    return `${hex}${a}`;
  }
  // hsl(...) → hsla(..., alpha)
  if (color.startsWith('hsl(')) {
    return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
  }
  // hsla(...) → replace existing alpha
  if (color.startsWith('hsla(')) {
    return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  // rgb(...) → rgba(..., alpha)
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  // rgba(...) → replace existing alpha
  if (color.startsWith('rgba(')) {
    return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  // fallback: return as-is
  return color;
}
