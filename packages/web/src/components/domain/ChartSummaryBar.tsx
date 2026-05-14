import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SignedPercent } from '@/components/shared/SignedPercent';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/formatters';

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

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm qv-fade-in">
      <SignedPercent value={totalReturn} />

      <Separator orientation="vertical" className="h-3" />

      {isPrivate ? (
        <span className="text-muted-foreground">••••••</span>
      ) : (
        <CurrencyDisplay value={absoluteGain} colorize className="qv-numeric text-sm" />
      )}

      <Separator orientation="vertical" className="h-3" />

      <span className="text-muted-foreground">
        {formatDate(periodStart)} – {formatDate(periodEnd)}
      </span>
    </div>
  );
}
