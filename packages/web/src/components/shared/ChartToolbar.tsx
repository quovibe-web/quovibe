import { useTranslation } from 'react-i18next';
import {
  TrendingUp, AreaChart, ChartCandlestick, BarChart3, GitCompareArrows, BarChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type ChartSeriesType, SINGLE_VALUE_TYPES, OHLC_TYPES,
  saveChartType,
} from '@/lib/chart-types';

const ICONS: Record<ChartSeriesType, React.ComponentType<{ className?: string }>> = {
  line: TrendingUp,
  area: AreaChart,
  candlestick: ChartCandlestick,
  bar: BarChart3,
  baseline: GitCompareArrows,
  histogram: BarChart,
};

interface ChartToolbarProps {
  chartId: string;
  activeType: ChartSeriesType;
  hasOhlc: boolean;
  onTypeChange: (type: ChartSeriesType) => void;
  className?: string;
}

export function ChartToolbar({ chartId, activeType, hasOhlc, onTypeChange, className }: ChartToolbarProps) {
  const { t } = useTranslation('common');
  const types = hasOhlc ? OHLC_TYPES : SINGLE_VALUE_TYPES;

  const handleClick = (type: ChartSeriesType) => {
    saveChartType(chartId, type);
    onTypeChange(type);
  };

  return (
    <div className={cn('flex gap-0.5 rounded-md border bg-muted/50 p-0.5', className)}>
      {types.map((type) => {
        const Icon = ICONS[type];
        return (
          <button
            key={type}
            onClick={() => handleClick(type)}
            className={cn(
              'rounded p-1.5 transition-colors',
              activeType === type
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
            )}
            title={t(`chartTypes.${type}`)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
