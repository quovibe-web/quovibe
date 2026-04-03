import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { usePaymentsBreakdown } from '@/api/use-reports';
import { ChartTooltip } from '@/components/shared/ChartTooltip';

interface PaymentBreakdownTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  activeBucket: string | null;
  type: 'DIVIDEND' | 'INTEREST';
  groupBy: 'month' | 'quarter' | 'year';
  amountMode: 'gross' | 'net';
  // Note: no `isPrivate` prop — CurrencyDisplay handles privacy internally via usePrivacy()
}

export function PaymentBreakdownTooltip({
  active,
  payload,
  label,
  activeBucket,
  type,
  groupBy,
  amountMode,
}: PaymentBreakdownTooltipProps) {
  const { t } = useTranslation('reports');
  const { data, isPending, isSuccess, isError } = usePaymentsBreakdown(activeBucket, type, groupBy);

  if (!active) return null;

  // Use payload value for instant display; switch to exact API total when loaded
  const payloadValue = payload?.[0]?.value ?? 0;
  const isBreakdownReady = isSuccess && data && data.bucket === activeBucket;

  const totalLabel =
    amountMode === 'gross'
      ? t('payments.breakdown.totalGross')
      : t('payments.breakdown.totalNet');

  return (
    <ChartTooltip label={label} className="min-w-[200px]">
      {/* Phase 2: breakdown rows — visible once activeBucket is set */}
      {activeBucket && (
        <>
          {/* Loading state */}
          {isPending && (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-0.5">
                  <Skeleton className="h-3 w-24 bg-muted-foreground/20" />
                  <Skeleton className="h-3 w-14 bg-muted-foreground/20" />
                </div>
              ))}
            </>
          )}

          {/* Error state */}
          {isError && (
            <div className="text-xs text-destructive italic">
              {t('payments.breakdown.error')}
            </div>
          )}

          {/* Success state */}
          {isBreakdownReady && data.items.map((item) => {
            const amount = amountMode === 'gross' ? item.grossAmount : item.netAmount;
            return (
              <div key={item.id} className="flex items-center justify-between gap-4 py-0.5">
                <span className="text-xs text-foreground max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.name}
                </span>
                <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                  <CurrencyDisplay value={parseFloat(amount)} currency={item.currencyCode ?? undefined} />
                </span>
              </div>
            );
          })}

          <div className="border-t border-[var(--qv-border)] my-1.5" />
        </>
      )}

      {/* Phase 1: total — always visible for instant feedback */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">{totalLabel}</span>
        <span className="text-sm font-semibold tabular-nums">
          {isBreakdownReady ? (
            <CurrencyDisplay
              value={parseFloat(amountMode === 'gross' ? data.totalGross : data.totalNet)}
              currency={data.items[0]?.currencyCode ?? undefined}
            />
          ) : (
            <CurrencyDisplay value={payloadValue} />
          )}
        </span>
      </div>
    </ChartTooltip>
  );
}
