import type { ChartSeriesType } from './chart-types';
import { withAlpha } from './chart-types';

type SeriesTypeName = 'Line' | 'Area' | 'Candlestick' | 'Bar' | 'Baseline' | 'Histogram';

interface BuildSeriesInput {
  color: string;
  /** For baseline series: the price that separates profit/loss zones */
  basePrice?: number;
  /** For baseline series: color for values above basePrice */
  profitColor?: string;
  /** For baseline series: color for values below basePrice */
  lossColor?: string;
  priceScaleId?: string;
  lineStyle?: number;
  visible?: boolean;
}

interface BuildSeriesResult {
  seriesType: SeriesTypeName;
  options: Record<string, unknown>;
}

const COMMON_OPTIONS = {
  lineWidth: 2.5,
  lastValueVisible: false,
  priceLineVisible: false,
} as const;

/**
 * Build the series constructor name and options object for a given chart type.
 * The caller is responsible for calling `chart.addSeries(SeriesConstructor, options)`.
 * This factory centralizes the options logic so it can be tested in isolation.
 */
export function buildSeriesOptions(
  type: ChartSeriesType,
  input: BuildSeriesInput,
): BuildSeriesResult {
  const { color, priceScaleId, lineStyle, visible } = input;
  const extraOpts: Record<string, unknown> = {};
  if (priceScaleId !== undefined) extraOpts.priceScaleId = priceScaleId;
  if (lineStyle !== undefined) extraOpts.lineStyle = lineStyle;
  if (visible !== undefined) extraOpts.visible = visible;

  switch (type) {
    case 'candlestick':
      return {
        seriesType: 'Candlestick',
        options: { ...COMMON_OPTIONS, ...extraOpts },
      };

    case 'bar':
      return {
        seriesType: 'Bar',
        options: { ...COMMON_OPTIONS, ...extraOpts },
      };

    case 'area':
      return {
        seriesType: 'Area',
        options: {
          lineColor: color,
          topColor: withAlpha(color, 0.35),
          bottomColor: 'transparent',
          ...COMMON_OPTIONS,
          ...extraOpts,
        },
      };

    case 'baseline':
      return {
        seriesType: 'Baseline',
        options: {
          baseValue: { type: 'price', price: input.basePrice ?? 0 },
          topLineColor: input.profitColor ?? color,
          topFillColor1: withAlpha(input.profitColor ?? color, 0.25),
          topFillColor2: 'transparent',
          bottomLineColor: input.lossColor ?? color,
          bottomFillColor1: 'transparent',
          bottomFillColor2: withAlpha(input.lossColor ?? color, 0.25),
          ...COMMON_OPTIONS,
          ...extraOpts,
        },
      };

    case 'histogram':
      return {
        seriesType: 'Histogram',
        options: {
          color: withAlpha(color, 0.69),
          ...COMMON_OPTIONS,
          ...extraOpts,
        },
      };

    case 'line':
    default:
      return {
        seriesType: 'Line',
        options: {
          color,
          ...COMMON_OPTIONS,
          ...extraOpts,
        },
      };
  }
}
