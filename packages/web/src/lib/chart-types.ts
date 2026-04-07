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
 * Apply alpha to any CSS color string (hex, hsl, rgb — both comma and space syntax).
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

  // Modern space-separated with slash alpha: hsl(225 15% 20% / 0.8) or rgb(255 0 0 / 0.8)
  if (/^(hsl|rgb)\(.*\//.test(color)) {
    return color.replace(/\/\s*[\d.]+\s*\)$/, `/ ${alpha})`);
  }

  // Modern space-separated without alpha: hsl(225 15% 20%) or rgb(255 0 0)
  // Detect by checking for NO commas inside the parens
  if (/^(hsl|rgb)\([^,]+\)$/.test(color)) {
    return color.replace(')', ` / ${alpha})`);
  }

  // Legacy comma syntax: hsla(h, s, l, a) → replace alpha
  if (color.startsWith('hsla(')) {
    return color.replace(/,\s*[\d.]+\s*\)$/, `, ${alpha})`);
  }

  // Legacy comma syntax: hsl(h, s, l) → add alpha
  if (color.startsWith('hsl(')) {
    return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
  }

  // Legacy comma syntax: rgba(r, g, b, a) → replace alpha
  if (color.startsWith('rgba(')) {
    return color.replace(/,\s*[\d.]+\s*\)$/, `, ${alpha})`);
  }

  // Legacy comma syntax: rgb(r, g, b) → add alpha
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }

  // fallback: return as-is
  return color;
}
