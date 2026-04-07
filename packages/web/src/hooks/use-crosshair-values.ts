import { useState, useEffect, useCallback } from 'react';
import type { IChartApi, MouseEventParams } from 'lightweight-charts';
import type { LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';

/**
 * Subscribes to a Lightweight Charts crosshair move event and extracts
 * formatted values for each legend series item.
 *
 * Returns a Map<itemId, formattedValue> that updates on every crosshair move.
 */
export function useCrosshairValues(
  chart: IChartApi | null,
  items: Pick<LegendSeriesItem, 'id' | 'series' | 'formatValue'>[],
): Map<string, string> {
  const [crosshairValues, setCrosshairValues] = useState<Map<string, string>>(new Map());

  const handleCrosshairMove = useCallback((param: MouseEventParams) => {
    const values = new Map<string, string>();
    if (param.time) {
      for (const item of items) {
        const data = param.seriesData.get(item.series);
        if (data) {
          const val = 'value' in data ? (data as { value: number }).value
            : 'close' in data ? (data as { close: number }).close
            : null;
          if (val != null) {
            values.set(item.id, item.formatValue ? item.formatValue(val) : val.toFixed(2));
          }
        }
      }
    }
    setCrosshairValues(values);
  }, [items]);

  useEffect(() => {
    if (!chart) return;
    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove);
  }, [chart, handleCrosshairMove]);

  return crosshairValues;
}
