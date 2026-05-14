import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  Cell,
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

export function CalculationWaterfallChart({ data, onBarClick }: CalculationWaterfallChartProps) {
  const { t } = useTranslation('performance');
  const { isPrivate } = usePrivacy();
  const bars = useMemo(() => buildWaterfallData(data), [data]);
  const showScaleToggle = useMemo(() => shouldShowMagnitudeScaleToggle(bars), [bars]);
  const [scale, setScale] = useState<'linear' | 'log'>('linear');

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
                data={bars}
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
                <YAxis hide scale={scale === 'log' ? 'log' : 'linear'} domain={['auto', 'auto']} allowDataOverflow />
                {/* Invisible base bar creates the floating offset */}
                <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
                <Bar
                  dataKey="value"
                  stackId="wf"
                  isAnimationActive={false}
                  label={(props: {
                    x?: number; y?: number; width?: number; value?: number; index?: number;
                  }) => {
                    if (props.value == null || props.index == null) return null;
                    const bar = bars[props.index];
                    if (!bar || bar.magnitude === 0) return null;
                    const isAnchorBar = bar.isAnchor;
                    const numeric = formatCurrency(bar.magnitude, data.baseCurrency);
                    const sign = isAnchorBar ? '' : bar.value > 0 ? '+' : '−';
                    const colorVar = COLOR_VAR[bar.color];
                    const x = (props.x ?? 0) + (props.width ?? 0) / 2;
                    const y = (props.y ?? 0) - 8;
                    return (
                      <text
                        x={x}
                        y={y}
                        textAnchor="middle"
                        fontSize={11}
                        fontFamily="'IBM Plex Mono', monospace"
                        fill={colorVar}
                      >
                        {sign}{numeric}
                      </text>
                    );
                  }}
                >
                  {bars.map((bar, i) => (
                    <Cell
                      key={i}
                      fill={COLOR_VAR[bar.color]}
                      cursor="pointer"
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
