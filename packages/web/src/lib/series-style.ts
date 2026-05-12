import type { LineStyle, SeriesRole } from '@quovibe/shared';
import { withAlpha } from './chart-types';

interface Input {
  role: SeriesRole;
  /** Base color (any CSS color the project supports — hex preferred). */
  color: string;
  /** True when the user is hovering over this specific series. */
  isHovered: boolean;
  /** True when the user is hovering over ANY series (used to dim peers). */
  anyHovered: boolean;
}

interface Output {
  lineWidth: number;
  lineStyle: LineStyle;
  color: string;
}

/**
 * Compute the visual style for a chart series based on its role and hover state.
 *
 * Rules (precedence in order applied):
 * 1. Role determines base lineWidth and lineStyle:
 *    - portfolio: 3px solid
 *    - holding:   2px solid
 *    - reference: 1.5px dashed, color alpha 0.85
 * 2. If isHovered: lineWidth += 0.5 AND color clears any role-default alpha (focal point).
 * 3. Else if anyHovered (peer): color alpha forced to 0.35 (overrides role default).
 *
 * Pure function — safe in render and useMemo.
 */
export function getSeriesStyle({ role, color, isHovered, anyHovered }: Input): Output {
  let lineWidth: number;
  let lineStyle: LineStyle;
  let effectiveColor = color;

  switch (role) {
    case 'portfolio':
      lineWidth = 3;
      lineStyle = 'solid';
      break;
    case 'holding':
      lineWidth = 2;
      lineStyle = 'solid';
      break;
    case 'reference':
      lineWidth = 1.5;
      lineStyle = 'dashed';
      effectiveColor = withAlpha(color, 0.85);
      break;
  }

  if (isHovered) {
    lineWidth += 0.5; // native-ok
    // Hover wins over role-default alpha — the hovered series is the focal point.
    effectiveColor = withAlpha(color, 1.0);
  } else if (anyHovered) {
    // Peer dimming when another series is hovered.
    effectiveColor = withAlpha(color, 0.35);
  }

  return { lineWidth, lineStyle, color: effectiveColor };
}
