import { useTranslation } from 'react-i18next';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { ChartTooltip } from '@/components/shared/ChartTooltip';
import { useChartColors } from '@/hooks/use-chart-colors';

interface IncomeStackedBreakdownTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number; dataKey?: string; payload?: { bucket: string } }>;
  label?: string;
  amountMode: 'gross' | 'net';
}

export function IncomeStackedBreakdownTooltip({
  active,
  payload,
  label,
  amountMode,
}: IncomeStackedBreakdownTooltipProps) {
  const { t } = useTranslation('reports');
  const { dividend, interest } = useChartColors();

  if (!active || !payload || payload.length === 0) return null;

  const dividendValue = payload.find((p) => p.dataKey === 'dividend')?.value ?? 0;
  const interestValue = payload.find((p) => p.dataKey === 'interest')?.value ?? 0;
  const total = dividendValue + interestValue;

  const totalLabel =
    amountMode === 'gross'
      ? t('payments.breakdown.totalGross')
      : t('payments.breakdown.totalNet');

  return (
    <div style={{ transform: 'translate(-50%, -100%)', marginTop: -8 }}>
      <ChartTooltip label={label} className="min-w-[200px]">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: dividend }} />
              {t('payments.dividends')}
            </span>
            <span className="text-sm tabular-nums">
              <CurrencyDisplay value={dividendValue} animated={false} />
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: interest }} />
              {t('payments.interest')}
            </span>
            <span className="text-sm tabular-nums">
              <CurrencyDisplay value={interestValue} animated={false} />
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--qv-border-subtle)] pt-1.5">
            <span className="text-xs text-muted-foreground">{totalLabel}</span>
            <span className="text-sm font-semibold tabular-nums">
              <CurrencyDisplay value={total} animated={false} />
            </span>
          </div>
        </div>
      </ChartTooltip>
    </div>
  );
}
