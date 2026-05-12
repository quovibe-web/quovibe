import type { ResolvedSeries } from '@/api/use-chart-series';
import type { SeriesAxis } from '@quovibe/shared';

/**
 * Compute the value range (max - min) of a series's data points.
 * Returns 0 for empty or single-point arrays.
 */
function rangeOf(data: ResolvedSeries['data']): number {
  if (data.length < 2) return 0; // native-ok
  let min = data[0]!.value;
  let max = data[0]!.value;
  for (let i = 1; i < data.length; i++) { // native-ok
    const v = data[i]!.value;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/**
 * Decide which y-axis a series renders on, given the portfolio reference series.
 *
 * Rules (first matching rule wins):
 * 1. Explicit `axis: 'left'` or `axis: 'right'` overrides everything.
 * 2. The portfolio-default series always renders on the left axis.
 * 3. A series with non-`ok` status defaults to left (so its rail row anchors next to portfolio).
 * 4. If the portfolio has no usable range data (status != 'ok' OR range == 0), the series renders left.
 * 5. Otherwise: right axis when this series's value range exceeds 2× portfolio range; else left.
 *
 * Pure function — safe to call inside `useMemo` or render.
 */
export function resolveAxis(
  series: ResolvedSeries,
  portfolio: ResolvedSeries,
): 'left' | 'right' {
  const axisOverride: SeriesAxis | undefined = (series.config as { axis?: SeriesAxis }).axis;
  if (axisOverride === 'left' || axisOverride === 'right') return axisOverride;

  if (series.config.id === 'portfolio-default') return 'left';
  if (series.status !== 'ok') return 'left';
  if (portfolio.status !== 'ok') return 'left';

  const portRange = rangeOf(portfolio.data);
  if (portRange === 0) return 'left'; // native-ok

  const seriesRange = rangeOf(series.data);
  return seriesRange > 2 * portRange ? 'right' : 'left'; // native-ok
}
