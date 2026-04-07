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
