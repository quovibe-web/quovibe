import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

export interface ActiveBar {
  bucket: string;
  x: number;
  y: number;
  width: number;
  chartWidth: number;
}

interface RechartsBarMouseData {
  x: number;
  y: number;
  width: number;
  payload?: { bucket: string };
}

/**
 * Half-width used to clamp tooltip position to chart bounds so the centered
 * tooltip card stays fully inside the chart's left/right edges on edge bars
 * (the rightmost-year-bar regression). 110 px covers the widest tooltip in
 * use today (PaymentBreakdownTooltip's `min-w-[200px]` plus an 8 px safety
 * margin); revisit if a future tooltip needs more horizontal space.
 */
const DEFAULT_TOOLTIP_HALF_WIDTH = 110;

export interface ActiveBarHandlers {
  onMouseEnter: (
    data: RechartsBarMouseData,
    index: number,
    event: ReactMouseEvent<SVGPathElement | SVGRectElement>,
  ) => void;
  onMouseLeave: () => void;
}

export interface ActiveBarTooltipProps {
  active: boolean;
  position: { x: number; y: number } | undefined;
}

export interface UseActiveBarResult {
  activeBar: ActiveBar | null;
  barHandlers: ActiveBarHandlers;
  tooltipProps: ActiveBarTooltipProps;
}

/**
 * Drives a recharts BarChart with a controlled, bar-anchored tooltip. The
 * `barHandlers` go on `<Bar onMouseEnter onMouseLeave>` (NOT on `<BarChart>` —
 * chart-area events would re-introduce the trigger-anywhere bug). The
 * `tooltipProps` go on `<Tooltip {...tooltipProps}>` and pin the popover to
 * the hovered bar's top-center via `position={{x, y}}`, clamped to the
 * chart's horizontal bounds so the tooltip never overflows the chart wrapper.
 *
 * Pair the consumer `<Tooltip content>` with a `<ChartTooltip centered>` so
 * the rendered card is offset above-and-centered from the anchor coordinate.
 *
 * `onEnter` is an optional side-effect (e.g. React Query prefetch) keyed by
 * the entered bar's bucket.
 */
export function useActiveBar(onEnter?: (bucket: string) => void): UseActiveBarResult {
  const [activeBar, setActiveBar] = useState<ActiveBar | null>(null);

  const barHandlers: ActiveBarHandlers = {
    onMouseEnter: (data, _index, event) => {
      const bucket = data.payload?.bucket;
      if (!bucket) return;
      const svg = event?.currentTarget?.ownerSVGElement;
      const chartWidth = svg?.getBoundingClientRect().width ?? Infinity;
      setActiveBar({ bucket, x: data.x, y: data.y, width: data.width, chartWidth });
      onEnter?.(bucket);
    },
    onMouseLeave: () => {
      setActiveBar(null);
    },
  };

  let position: { x: number; y: number } | undefined;
  if (activeBar) {
    const barCenter = activeBar.x + activeBar.width / 2;
    const clampMin = Math.min(DEFAULT_TOOLTIP_HALF_WIDTH, activeBar.chartWidth / 2);
    const clampMax = Math.max(clampMin, activeBar.chartWidth - DEFAULT_TOOLTIP_HALF_WIDTH);
    const clampedX = Math.max(clampMin, Math.min(barCenter, clampMax));
    position = { x: clampedX, y: activeBar.y };
  }

  return {
    activeBar,
    barHandlers,
    tooltipProps: { active: activeBar !== null, position },
  };
}
