import { useState, useCallback, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Treemap } from 'recharts';
import { useTranslation } from 'react-i18next';
import type { HoldingsItem } from '@/api/types';
import { formatCurrency, formatPercentage } from '@/lib/formatters';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { ChartTooltip } from '@/components/shared/ChartTooltip';
import { FadeIn } from '@/components/shared/FadeIn';

interface TaxonomyChartProps {
  items: HoldingsItem[];
  totalMarketValue?: string;
  showCenterLabel?: boolean;
  showLegend?: boolean;
  highlightedId?: string | null;
  onHighlightChange?: (id: string | null) => void;
  mode?: 'pie' | 'treemap';
  centerLabel?: string;
}

interface TreemapContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  percentage: number;
  color: string;
}

function TreemapContent({ x, y, width, height, name, percentage, color }: TreemapContentProps) {
  if (width <= 0 || height <= 0) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={color} opacity={0.85} stroke="var(--color-background)" strokeWidth={2} />
      {width > 60 && height > 40 && (
        <>
          <text x={x + 8} y={y + 20} fill="var(--color-primary-foreground)" fontSize={14} fontWeight={600} className="pointer-events-none">
            {name.length > Math.floor(width / 9) ? name.slice(0, Math.floor(width / 9)) + '…' : name}
          </text>
          <text x={x + 8} y={y + 38} fill="var(--color-primary-foreground)" fillOpacity={0.7} fontSize={13} className="pointer-events-none">
            {(percentage).toFixed(1)}%
          </text>
        </>
      )}
    </g>
  );
}

export function TaxonomyChart({
  items, totalMarketValue, showCenterLabel = true,
  showLegend = true, highlightedId, onHighlightChange, mode = 'pie',
  centerLabel,
}: TaxonomyChartProps) {
  const { t } = useTranslation('reports');
  const { isPrivate } = usePrivacy();
  const baseCurrency = useBaseCurrency();
  const { palette } = useChartColors();
  const [localActiveIndex, setLocalActiveIndex] = useState<number | null>(null);

  const data = useMemo(
    () =>
      items
        .filter((item) => parseFloat(item.marketValue) > 0)
        .map((item, i) => ({
          id: item.securityId,
          name: item.name,
          value: parseFloat(item.marketValue),
          percentage: parseFloat(item.percentage),
          color: item.color || palette[i % palette.length],
        })),
    [items, palette],
  );

  const activeIndex = useMemo(() => {
    if (highlightedId !== undefined) {
      if (!highlightedId) return null;
      const idx = data.findIndex(d => d.id === highlightedId);
      return idx >= 0 ? idx : null;
    }
    return localActiveIndex;
  }, [highlightedId, data, localActiveIndex]);

  const handleMouseEnter = useCallback((_: unknown, index: number) => {
    if (onHighlightChange) {
      onHighlightChange(data[index]?.id ?? null);
    } else {
      setLocalActiveIndex(index);
    }
  }, [data, onHighlightChange]);

  const handleMouseLeave = useCallback(() => {
    if (onHighlightChange) {
      onHighlightChange(null);
    } else {
      setLocalActiveIndex(null);
    }
  }, [onHighlightChange]);

  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('holdings.noHoldingsData')}</p>;
  }

  const total = totalMarketValue
    ? parseFloat(totalMarketValue)
    : data.reduce((sum, d) => sum + d.value, 0);

  const activeItem = activeIndex !== null ? data[activeIndex] : null;

  return (
    <FadeIn>
    <div
      style={{
        filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
        transition: 'filter 0.2s ease',
      }}
    >
      <div className="flex flex-col md:flex-row items-center gap-6">
        {mode === 'treemap' ? (
          <div className="w-full h-[320px]">
            <ResponsiveContainer width="100%" height={320}>
              <Treemap
                data={data}
                dataKey="value"
                nameKey="name"
                aspectRatio={4 / 3}
                animationDuration={600}
                content={<TreemapContent x={0} y={0} width={0} height={0} name="" percentage={0} color="" />}
              >
                {data.map((entry) => (
                  <Cell key={entry.id} fill={entry.color} />
                ))}
                <Tooltip
                  content={({ payload }) => {
                    const item = payload?.[0]?.payload;
                    if (!item?.name) return null;
                    return (
                      <ChartTooltip>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-muted-foreground">
                          {formatCurrency(item.value, baseCurrency)}
                          {item.percentage != null && ` (${formatPercentage(item.percentage / 100)})`}
                        </div>
                      </ChartTooltip>
                    );
                  }}
                />
              </Treemap>
            </ResponsiveContainer>
          </div>
        ) : (
          /* Donut chart with interactive center label */
          <div className="relative w-[260px] h-[260px] flex-shrink-0">
            <ResponsiveContainer width={260} height={260}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={115}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={1}
                  stroke="var(--color-background)"
                  strokeWidth={2}
                  animationDuration={800}
                  animationEasing="ease-out"
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                >
                  {data.map((entry, i) => (
                    <Cell
                      key={entry.id}
                      fill={entry.color}
                      opacity={activeIndex !== null && activeIndex !== i ? 0.7 : 1}
                      style={{ transition: 'opacity 0.2s ease' }}
                    />
                  ))}
                </Pie>
                {/* Fallback tooltip only when no center label */}
                {!showCenterLabel && (
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload;
                      return (
                        <ChartTooltip>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-muted-foreground">
                            {formatCurrency(item.value, baseCurrency)}
                            {item.percentage != null && ` (${formatPercentage(item.percentage / 100)})`}
                          </div>
                        </ChartTooltip>
                      );
                    }}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
            {/* Interactive center label: shows hovered item or total */}
            {showCenterLabel && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {activeItem ? (
                  <>
                    <span
                      className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-medium text-center max-w-[110px] truncate"
                      style={{ color: activeItem.color }}
                    >
                      {activeItem.name}
                    </span>
                    <span className="text-sm font-semibold tabular-nums mt-0.5">
                      {formatCurrency(activeItem.value, baseCurrency)}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {formatPercentage(activeItem.percentage / 100)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
                      {centerLabel ?? t('common:total')}
                    </span>
                    <span className="text-base font-semibold tabular-nums mt-0.5">
                      {isPrivate ? '••••••' : formatCurrency(total, baseCurrency)}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Custom legend */}
        {showLegend && mode !== 'treemap' && (
          <div className="flex-1 min-w-0 w-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
              {data.map((entry, i) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors cursor-default group"
                  style={{
                    opacity: activeIndex !== null && activeIndex !== i ? 0.4 : 1,
                    transition: 'opacity 0.2s ease',
                  }}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-transparent group-hover:ring-offset-1 group-hover:ring-[var(--qv-border-strong)] transition-all"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-sm truncate flex-1 min-w-0">{entry.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground flex-shrink-0 font-medium">
                    {formatPercentage(entry.percentage / 100)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </FadeIn>
  );
}
