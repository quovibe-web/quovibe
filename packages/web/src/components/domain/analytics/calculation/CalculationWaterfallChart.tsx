import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  Cell,
  LabelList,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { EmptyState } from '@/components/shared/EmptyState';
import { TrendingUp } from 'lucide-react';
import { usePrivacy } from '@/context/privacy-context';
import { formatCurrency } from '@/lib/formatters';
import {
  buildWaterfallData,
  categoryIdForBar,
  shouldShowMagnitudeScaleToggle,
  type WaterfallBar,
  type WaterfallBarColor,
  type CategoryId,
} from '@/lib/calculation-waterfall';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

interface CalculationWaterfallChartProps {
  data: CalculationBreakdownResponse;
  onBarClick: (categoryId: CategoryId) => void;
}

const COLOR_VAR: Record<WaterfallBarColor, string> = {
  secondary: 'var(--qv-text-secondary)',
  positive: 'var(--qv-positive)',
  negative: 'var(--qv-negative)',
  muted: 'var(--qv-text-muted)',
  display: 'var(--qv-text-display)',
};

interface LabelProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
}

export function CalculationWaterfallChart({ data, onBarClick }: CalculationWaterfallChartProps) {
  const { t } = useTranslation('performance');
  const { isPrivate } = usePrivacy();
  const bars = useMemo(() => buildWaterfallData(data), [data]);
  // Exclude zero-magnitude bars from the chart data so the LabelList
  // iteration index stays aligned with the rect array Recharts produces.
  // (Recharts filters height===0 rects before passing to LabelList, so
  // a bars[index] lookup would be off-by-one whenever MVB is zero.)
  const visibleBars = useMemo(() => bars.filter((b) => b.magnitude > 0), [bars]);
  const showScaleToggle = useMemo(() => shouldShowMagnitudeScaleToggle(bars), [bars]);
  const [scale, setScale] = useState<'linear' | 'log'>('linear');

  const yDomain = useMemo<[number, number]>(() => {
    const allVals = bars.flatMap((b) => [b.base, b.base + b.value]);
    const lo = Math.min(0, ...allVals);
    const hi = Math.max(...allVals);
    const pad = (hi - lo) * 0.12;
    return [lo - pad, hi + pad];
  }, [bars]);

  const allMiddleZero =
    bars[1].magnitude === 0 && bars[2].magnitude === 0 && bars[3].magnitude === 0;

  return (
    <Card className="rounded-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <span className="qv-eyebrow">{t('calculation.waterfall.title')}</span>
        {showScaleToggle && !allMiddleZero && (
          <SegmentedControl
            size="sm"
            segments={[
              { value: 'linear', label: t('calculation.waterfall.linearScale') },
              { value: 'log',    label: t('calculation.waterfall.logScale') },
            ]}
            value={scale}
            onChange={setScale}
          />
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {allMiddleZero ? (
          <EmptyState
            icon={TrendingUp}
            title={t('calculation.waterfall.emptyPeriod')}
          />
        ) : (
          <div
            className="min-h-[320px]"
            style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none' }}
          >
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={visibleBars}
                margin={{ top: 30, right: 16, left: 16, bottom: 30 }}
                onClick={(state) => {
                  // Recharts passes payload via activePayload[0].payload
                  const payload = (state as { activePayload?: Array<{ payload?: WaterfallBar }> })
                    ?.activePayload?.[0]?.payload;
                  if (payload?.name) onBarClick(categoryIdForBar(payload.name));
                }}
              >
                <CartesianGrid stroke="var(--qv-border-subtle)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'var(--qv-text-muted)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--qv-border-subtle)' }}
                  tickFormatter={(name: string) =>
                    t(`calculation.waterfall.${name.toLowerCase()}`, { defaultValue: name })
                  }
                />
                <YAxis
                  hide
                  scale={scale === 'log' ? 'log' : 'linear'}
                  domain={yDomain}
                  allowDataOverflow
                />
                <Bar
                  dataKey="range"
                  isAnimationActive={false}
                  radius={[2, 2, 2, 2]}
                >
                  {visibleBars.map((bar, i) => (
                    <Cell key={i} fill={COLOR_VAR[bar.color]} cursor="pointer" />
                  ))}
                  <LabelList
                    content={((labelProps: LabelProps) => {
                      const { index, x = 0, width = 0, y = 0 } = labelProps;
                      if (index == null) return null;
                      const bar = visibleBars[index];
                      if (!bar) return null;
                      const numeric = formatCurrency(bar.magnitude, data.baseCurrency);
                      const sign = bar.isAnchor ? '' : bar.value > 0 ? '+' : '−';
                      return (
                        <text
                          key={index}
                          x={x + width / 2}
                          y={y - 8}
                          textAnchor="middle"
                          fontSize={11}
                          fontFamily="'IBM Plex Mono', monospace"
                          fill={COLOR_VAR[bar.color]}
                        >
                          {sign}{numeric}
                        </text>
                      );
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
