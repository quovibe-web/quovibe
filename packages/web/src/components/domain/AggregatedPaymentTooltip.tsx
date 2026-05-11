import { useTranslation } from 'react-i18next';
import type { TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { ChartTooltip } from '@/components/shared/ChartTooltip';

interface AggregatedPaymentTooltipProps extends Partial<TooltipContentProps<ValueType, NameType>> {
  amountMode: 'gross' | 'net';
}

export function AggregatedPaymentTooltip({
  active,
  payload,
  label,
  amountMode,
}: AggregatedPaymentTooltipProps) {
  const { t } = useTranslation('reports');
  const first = payload?.[0];
  if (!active || !first) return null;
  const value = typeof first.value === 'number' ? first.value : 0;
  const totalLabel =
    amountMode === 'gross'
      ? t('payments.breakdown.totalGross')
      : t('payments.breakdown.totalNet');
  return (
    <ChartTooltip label={typeof label === 'string' ? label : undefined} className="min-w-[180px]" centered>
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">{totalLabel}</span>
        <span className="text-sm font-semibold tabular-nums">
          <CurrencyDisplay value={value} animated={false} />
        </span>
      </div>
    </ChartTooltip>
  );
}
