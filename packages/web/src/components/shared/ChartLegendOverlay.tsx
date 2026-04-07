import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { IChartApi, ISeriesApi, MouseEventParams, SeriesType } from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { usePrivacy } from '@/context/privacy-context';

export interface LegendSeriesItem {
  id: string;
  label: string;
  color: string;
  series: ISeriesApi<SeriesType>;
  visible: boolean;
  formatValue?: (value: number) => string;
}

interface ChartLegendOverlayProps {
  chart: IChartApi | null;
  items: LegendSeriesItem[];
  onToggleVisibility?: (id: string) => void;
  className?: string;
}

export function ChartLegendOverlay({ chart, items, onToggleVisibility, className }: ChartLegendOverlayProps) {
  const [crosshairValues, setCrosshairValues] = useState<Map<string, string>>(new Map());
  const { isPrivate } = usePrivacy();

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

  if (items.length === 0) return null;

  return (
    <div className={cn('absolute top-2 left-2 z-10 flex flex-wrap gap-x-4 gap-y-1 text-xs', className)}>
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-1.5">
          {onToggleVisibility && (
            <button
              onClick={() => onToggleVisibility(item.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              {item.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
          )}
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className={cn('text-muted-foreground', !item.visible && 'line-through opacity-50')}>
            {item.label}
          </span>
          {crosshairValues.has(item.id) && (
            <span className={cn('font-mono font-medium', isPrivate && 'blur-sm')}>
              {crosshairValues.get(item.id)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
