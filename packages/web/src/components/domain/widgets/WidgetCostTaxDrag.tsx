import { useTranslation } from 'react-i18next';
import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useReportingPeriod } from '@/api/use-performance';
import { usePrivacy } from '@/context/privacy-context';
import { computeDragMetrics } from '@/lib/drag-utils';
import { formatCurrency, formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FadeIn } from '@/components/shared/FadeIn';
import { differenceInCalendarDays, parseISO } from 'date-fns';

function AccentBar({ value, maxValue, color, isPrivate }: {
  value: number;
  maxValue: number;
  color: string;
  isPrivate: boolean;
}) {
  const widthPct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  return (
    <div
      className="h-1 rounded-full overflow-hidden"
      style={{
        background: 'var(--qv-surface, rgba(255,255,255,0.06))',
        filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
        transition: 'filter 0.2s ease',
      }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${widthPct}%`, background: color }}
      />
    </div>
  );
}

function DragColumn({ title, amount, gainsPct, expenseRatio, expenseLabel, color, isPrivate, gainsAvailable, t }: {
  title: string;
  amount: number;
  gainsPct: number | null;
  expenseRatio: number;
  expenseLabel: string;
  color: string;
  isPrivate: boolean;
  gainsAvailable: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
        {title}
      </div>
      <div className="text-2xl font-bold leading-tight tabular-nums" style={{ color }}>
        {isPrivate ? '••••' : <CurrencyDisplay value={amount} className="text-2xl font-bold" />}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        <div>
          <div className="flex justify-between text-[11px] text-muted-foreground mb-0.5">
            <span>{t('widget.costTaxDrag.gainsConsumed')}</span>
            <span className="font-semibold" style={{ color }}>
              {isPrivate ? '••••' : gainsAvailable && gainsPct !== null ? formatPercentage(gainsPct) : t('widget.costTaxDrag.notApplicable')}
            </span>
          </div>
          <AccentBar value={gainsPct ?? 0} maxValue={0.5} color={color} isPrivate={isPrivate} />
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-muted-foreground mb-0.5">
            <span>{expenseLabel}</span>
            <span className="font-semibold" style={{ color }}>
              {isPrivate ? '••••' : formatPercentage(expenseRatio)}
            </span>
          </div>
          <AccentBar value={expenseRatio} maxValue={0.05} color={color} isPrivate={isPrivate} />
        </div>
      </div>
    </div>
  );
}

export default function WidgetCostTaxDrag() {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, isError, error, isFetching } = useWidgetCalculation();
  const { isPrivate } = usePrivacy();

  const { periodOverride } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;

  const feeColor = '#fb923c';
  const taxColor = '#a78bfa';

  if (isLoading) {
    return (
      <div className="flex gap-4 p-4">
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="w-px bg-border" />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  const fees = parseFloat(data.fees.total);
  const taxes = parseFloat(data.taxes.total);
  const initialValue = parseFloat(data.initialValue);
  const finalValue = parseFloat(data.finalValue);
  const periodDays = differenceInCalendarDays(parseISO(periodEnd), parseISO(periodStart));

  const metrics = computeDragMetrics({
    fees,
    taxes,
    initialValue,
    finalValue,
    periodDays: Math.max(periodDays, 1),
  });

  const totalCosts = fees + taxes;

  return (
    <FadeIn>
      <div
        className={cn(
          'flex flex-col',
          isFetching && !isLoading && 'opacity-60 transition-opacity duration-200',
        )}
      >
        <div className="flex gap-5 px-4 pt-3 pb-3">
          <DragColumn
            title={t('widget.costTaxDrag.fees')}
            amount={fees}
            gainsPct={metrics.feeGainsPct}
            expenseRatio={metrics.feeExpenseRatio}
            expenseLabel={t('widget.costTaxDrag.expenseRatio')}
            color={feeColor}
            isPrivate={isPrivate}
            gainsAvailable={metrics.gainsAvailable}
            t={t}
          />
          <div className="w-px bg-border self-stretch" />
          <DragColumn
            title={t('widget.costTaxDrag.taxes')}
            amount={taxes}
            gainsPct={metrics.taxGainsPct}
            expenseRatio={metrics.taxExpenseRatio}
            expenseLabel={t('widget.costTaxDrag.taxRatio')}
            color={taxColor}
            isPrivate={isPrivate}
            gainsAvailable={metrics.gainsAvailable}
            t={t}
          />
        </div>

        <div className="flex justify-between items-center px-4 py-2.5 border-t border-border">
          <span className="text-xs text-muted-foreground">{t('widget.costTaxDrag.totalCostDrag')}</span>
          <div className="flex gap-3 items-baseline">
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {isPrivate ? '••••' : formatCurrency(totalCosts)}
            </span>
            {metrics.gainsAvailable && metrics.totalGainsPct !== null && (
              <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--qv-negative, #f87171)' }}>
                {isPrivate ? '••••' : `${formatPercentage(metrics.totalGainsPct)} ${t('widget.costTaxDrag.ofGains')}`}
              </span>
            )}
          </div>
        </div>

        {metrics.shortPeriodWarning && (
          <div className="px-4 pb-2 text-[10px] text-muted-foreground italic">
            {t('widget.costTaxDrag.shortPeriodWarning')}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
