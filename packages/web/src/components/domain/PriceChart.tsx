import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts';
import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatQuote } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useChartTheme } from '@/hooks/use-chart-theme';
import { useChartTicks } from '@/hooks/use-chart-ticks';
import { ChartTooltip } from '@/components/shared/ChartTooltip';
import { ChartLegend } from '@/components/shared/ChartLegend';
import { FadeIn } from '@/components/shared/FadeIn';
import { cn } from '@/lib/utils';

interface PricePoint {
  date: string;
  value: string;
}

interface TransactionMarker {
  date: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  amount?: number;
  currency?: string;
}

interface PriceChartProps {
  prices: PricePoint[];
  transactions?: TransactionMarker[];
  isFetching?: boolean;
}

export function PriceChart({ prices, transactions = [], isFetching }: PriceChartProps) {
  const { t } = useTranslation('securities');
  const { isPrivate } = usePrivacy();
  const { profit, loss, violet, palette } = useChartColors();
  const { gridColor, gridOpacity, tickColor, cursorColor, cursorDasharray } = useChartTheme();
  const { quotesPrecision } = useDisplayPreferences();

  const fmtQuote = useCallback(
    (v: number) => formatQuote(v, { quotesPrecision }),
    [quotesPrecision],
  );

  if (prices.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('priceChart.noData')}</p>;
  }

  const txByDate = new Map<string, TransactionMarker[]>();
  for (const tx of transactions) {
    const existing = txByDate.get(tx.date) ?? [];
    existing.push(tx);
    txByDate.set(tx.date, existing);
  }

  const data = prices.map((p) => {
    const txs = txByDate.get(p.date);
    return {
      date: p.date,
      value: parseFloat(p.value),
      transactions: txs ?? null,
    };
  });

  const chartDates = useMemo(() => data.map((d) => d.date), [data]);
  const { ticks, tickFormatter } = useChartTicks(chartDates);

  const priceByDate = new Map(data.map((d) => [d.date, d.value]));

  function markerColor(type: string) {
    if (type === 'BUY') return profit;
    if (type === 'SELL') return loss;
    return violet;
  }

  return (
    <FadeIn>
      <div
        className={cn(isFetching && 'opacity-60 transition-opacity duration-200')}
        style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={gridOpacity} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: tickColor, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              ticks={ticks}
              tickFormatter={tickFormatter}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: tickColor, fontSize: 11, style: { fontFeatureSettings: '"tnum"' } }}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={fmtQuote}
            />
            <Tooltip
              cursor={{ stroke: cursorColor, strokeDasharray: cursorDasharray }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as (typeof data)[number];
                return (
                  <ChartTooltip label={formatDate(label as string)}>
                    <div>{t('priceChart.price')}: {fmtQuote(point.value)}</div>
                    {point.transactions?.map((tx, i) => (
                      <div key={i} style={{ color: markerColor(tx.type) }}>
                        {tx.type === 'DIVIDEND' ? t('priceChart.div') : tx.type}
                        {tx.amount != null && tx.currency
                          ? `: ${fmtQuote(tx.amount)} ${tx.currency}`
                          : ''}
                      </div>
                    ))}
                  </ChartTooltip>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={palette[0]}
              strokeWidth={2}
              dot={false}
              activeDot={false}
              animationDuration={800}
              animationEasing="ease-out"
            />
            {transactions.map((tx, i) => {
              const price = priceByDate.get(tx.date);
              if (price == null) return null;
              return (
                <ReferenceDot
                  key={i}
                  x={tx.date}
                  y={price}
                  r={4}
                  fill={markerColor(tx.type)}
                  stroke="var(--color-foreground)"
                  strokeWidth={1.5}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
        {transactions.length > 0 && (
          <ChartLegend
            items={[
              { color: palette[0], label: t('priceChart.price'), type: 'line' },
              { color: profit, label: t('priceChart.buy'), type: 'dot' },
              { color: loss, label: t('priceChart.sell'), type: 'dot' },
              { color: violet, label: t('priceChart.div'), type: 'dot' },
            ]}
          />
        )}
      </div>
    </FadeIn>
  );
}
