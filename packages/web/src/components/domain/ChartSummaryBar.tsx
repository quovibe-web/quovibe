import NumberFlow from '@number-flow/react';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

interface ChartSummaryBarProps {
  totalReturn: number;
  absoluteGain: number;
  periodStart: string;
  periodEnd: string;
  isLoading: boolean;
}

export function ChartSummaryBar({
  totalReturn,
  absoluteGain,
  periodStart,
  periodEnd,
  isLoading,
}: ChartSummaryBarProps) {
  const { isPrivate } = usePrivacy();

  if (isLoading) {
    return <Skeleton className="h-5 w-64" />;
  }

  const isPositive = totalReturn >= 0;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {/* Total return */}
      <span className={cn('font-semibold', isPositive ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]')}>
        {isPrivate ? '••••••' : (
          <NumberFlow
            className="muted-fraction"
            value={totalReturn}
            locales={i18n.language}
            format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' }}
          />
        )}
      </span>

      <span className="text-muted-foreground/40">·</span>

      {/* Absolute gain/loss */}
      {isPrivate ? (
        <span className="text-muted-foreground">••••••</span>
      ) : (
        <CurrencyDisplay value={absoluteGain} colorize className="text-sm" />
      )}

      <span className="text-muted-foreground/40">·</span>

      {/* Period dates */}
      <span className="text-muted-foreground">
        {formatDate(periodStart)} – {formatDate(periodEnd)}
      </span>
    </div>
  );
}
