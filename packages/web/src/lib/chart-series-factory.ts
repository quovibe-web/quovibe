import type { SeriesRole, LineStyle } from '@quovibe/shared';
import { LineStyle as LwcLineStyle } from 'lightweight-charts';
import type { ChartSeriesType } from './chart-types';
import { withAlpha } from './chart-types';
import { getSeriesStyle } from './series-style';

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
  /** Legacy numeric lineStyle (lightweight-charts enum). Superseded by seriesRole when present. */
  lineStyle?: number;
  visible?: boolean;
  /**
   * When set, derives color, lineWidth, and lineStyle via getSeriesStyle.
   * Overrides the `color` and `lineStyle` inputs for the computed values.
   * Explicit `profitColor`/`lossColor` are NOT dimmed by hover — they are
   * caller-controlled overrides for baseline fill zones.
   */
  seriesRole?: SeriesRole;
  /** True when the user is hovering this specific series. Requires seriesRole. */
  isHovered?: boolean;
  /** True when ANY series is hovered. Requires seriesRole. */
  anyHovered?: boolean;
  /**
   * Enable the right-axis last-value badge + dashed price line for this series.
   * Default: true when `seriesRole === 'portfolio'`, false otherwise — keeps the
   * badge on the anchor series and avoids right-axis pile-up when many holdings
   * render. Callers without a portfolio role (e.g. PriceChart, single-security
   * widgets) opt in explicitly by passing `true`.
   */
  showLastValue?: boolean;
}

/** Map shared LineStyle string to lightweight-charts LineStyle enum value. */
function lineStyleStringToLwc(s: LineStyle): LwcLineStyle {
  switch (s) {
    case 'dashed': return LwcLineStyle.Dashed;
    case 'dotted': return LwcLineStyle.Dotted;
    default:       return LwcLineStyle.Solid;
  }
}

interface BuildSeriesResult {
  seriesType: SeriesTypeName;
  options: Record<string, unknown>;
}

const COMMON_OPTIONS = {
  lineWidth: 2.5,
} as const;

const AREA_FILL_ALPHA = 0.45;
const BASELINE_FILL_ALPHA = 0.40;
const HISTOGRAM_FILL_ALPHA = 0.69;

/**
 * Build the series constructor name and options object for a given chart type.
 * The caller is responsible for calling `chart.addSeries(SeriesConstructor, options)`.
 * This factory centralizes the options logic so it can be tested in isolation.
 *
 * When `seriesRole` is present, `color`, `lineWidth`, and `lineStyle` are derived
 * from `getSeriesStyle` (role-based weight hierarchy + hover dimming), overriding the
 * corresponding inputs. Explicit `profitColor`/`lossColor` are NOT hover-dimmed —
 * they are caller-controlled overrides for baseline fill zones.
 */
export function buildSeriesOptions(
  type: ChartSeriesType,
  input: BuildSeriesInput,
): BuildSeriesResult {
  const { color, priceScaleId, lineStyle, visible, seriesRole } = input;

  // Derive effective color, lineWidth, and lineStyle when a role is provided.
  let effectiveColor = color;
  let effectiveLineWidth: number | undefined;
  let effectiveLineStyleNum: number | undefined = lineStyle;

  if (seriesRole) {
    const style = getSeriesStyle({
      role: seriesRole,
      color,
      isHovered: input.isHovered ?? false,
      anyHovered: input.anyHovered ?? false,
    });
    effectiveColor = style.color;
    effectiveLineWidth = style.lineWidth;
    effectiveLineStyleNum = lineStyleStringToLwc(style.lineStyle);
  }

  const extraOpts: Record<string, unknown> = {};
  if (priceScaleId !== undefined) extraOpts.priceScaleId = priceScaleId;
  if (effectiveLineStyleNum !== undefined) extraOpts.lineStyle = effectiveLineStyleNum;
  if (visible !== undefined) extraOpts.visible = visible;
  // effectiveLineWidth is spread after COMMON_OPTIONS so it overrides the 2.5px default.
  if (effectiveLineWidth !== undefined) extraOpts.lineWidth = effectiveLineWidth;

  // Portfolio anchors get the right-axis last-value badge by default; everything else opts in.
  const showLastValue = input.showLastValue ?? (seriesRole === 'portfolio');
  const badgeOpts = showLastValue
    ? {
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineStyle: LwcLineStyle.Dashed,
        priceLineWidth: 1 as const,
        priceLineColor: effectiveColor,
      }
    : {
        lastValueVisible: false,
        priceLineVisible: false,
      };

  switch (type) {
    case 'candlestick':
      return {
        seriesType: 'Candlestick',
        options: { ...COMMON_OPTIONS, ...badgeOpts, ...extraOpts },
      };

    case 'bar':
      return {
        seriesType: 'Bar',
        options: { ...COMMON_OPTIONS, ...badgeOpts, ...extraOpts },
      };

    case 'area':
      return {
        seriesType: 'Area',
        options: {
          lineColor: effectiveColor,
          // relativeGradient anchors stops to data extrema, not axis edges —
          // fill follows the line, Bloomberg/IBKR feel vs flat-pastel.
          topColor: withAlpha(effectiveColor, AREA_FILL_ALPHA),
          bottomColor: 'transparent',
          relativeGradient: true,
          ...COMMON_OPTIONS,
          ...badgeOpts,
          ...extraOpts,
        },
      };

    case 'baseline':
      return {
        seriesType: 'Baseline',
        options: {
          baseValue: { type: 'price', price: input.basePrice ?? 0 },
          // profitColor/lossColor are explicit caller overrides — not hover-dimmed.
          // When absent, the effective (possibly dimmed) color is used as the fallback.
          topLineColor: input.profitColor ?? effectiveColor,
          topFillColor1: withAlpha(input.profitColor ?? effectiveColor, BASELINE_FILL_ALPHA),
          topFillColor2: 'transparent',
          bottomLineColor: input.lossColor ?? effectiveColor,
          bottomFillColor1: 'transparent',
          bottomFillColor2: withAlpha(input.lossColor ?? effectiveColor, BASELINE_FILL_ALPHA),
          relativeGradient: true,
          ...COMMON_OPTIONS,
          ...badgeOpts,
          ...extraOpts,
        },
      };

    case 'histogram':
      return {
        seriesType: 'Histogram',
        options: {
          color: withAlpha(effectiveColor, HISTOGRAM_FILL_ALPHA),
          ...COMMON_OPTIONS,
          ...badgeOpts,
          ...extraOpts,
        },
      };

    case 'line':
    default:
      return {
        seriesType: 'Line',
        options: {
          color: effectiveColor,
          ...COMMON_OPTIONS,
          ...badgeOpts,
          ...extraOpts,
        },
      };
  }
}
