import { useTranslation } from 'react-i18next';
import { useStatementOfAssets } from '@/api/use-reports';
import { usePrivacy } from '@/context/privacy-context';
import { formatCurrency } from '@/lib/formatters';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FadeIn } from '@/components/shared/FadeIn';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';

const CASH_COLOR = '#D0A215';
const INVESTED_COLOR = '#8B7EC8';

function DonutChart({ ratio, isPrivate }: { ratio: number; isPrivate: boolean }) {
  const r = 32;
  const circumference = 2 * Math.PI * r; // native-ok
  const cashArc = circumference * Math.min(ratio, 1); // native-ok
  const investedArc = circumference - cashArc; // native-ok

  return (
    <div
      className="relative mx-auto"
      style={{
        width: 80,
        height: 80,
        filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
        transition: 'filter 0.2s ease',
      }}
    >
      <svg viewBox="0 0 80 80" width={80} height={80} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={40} cy={40} r={r} fill="none" stroke="var(--qv-surface, rgba(255,255,255,0.06))" strokeWidth={8} />
        <circle
          cx={40} cy={40} r={r} fill="none"
          stroke={CASH_COLOR} strokeWidth={8}
          strokeDasharray={`${cashArc} ${circumference - cashArc}`}
          strokeLinecap="round"
        />
        <circle
          cx={40} cy={40} r={r} fill="none"
          stroke={INVESTED_COLOR} strokeWidth={8}
          strokeDasharray={`${investedArc} ${circumference - investedArc}`}
          strokeDashoffset={-cashArc}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export default function WidgetCashDrag() {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, isError, error, isFetching } = useStatementOfAssets();
  const { isPrivate } = usePrivacy();
  const baseCurrency = useBaseCurrency();

  const cashValue = data ? parseFloat(data.totals.cashValue) : 0;
  const marketValue = data ? parseFloat(data.totals.marketValue) : 0;
  const securityValue = data ? parseFloat(data.totals.securityValue) : 0;
  const cashRatio = marketValue > 0 ? cashValue / marketValue : 0; // native-ok

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-32" />
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

  return (
    <FadeIn>
      <div
        className={cn(
          'flex flex-col items-center py-3 px-4',
          isFetching && !isLoading && 'opacity-60 transition-opacity duration-200',
        )}
      >
        <div className="text-3xl font-bold tabular-nums" style={{ color: CASH_COLOR }}>
          {isPrivate ? '••••' : (
            <NumberFlow
              className="muted-fraction"
              value={cashRatio}
              locales={i18n.language}
              format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
            />
          )}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {t('widget.cashDrag.cashRatio')}
        </div>

        <div className="my-[26px]">
          <DonutChart ratio={cashRatio} isPrivate={isPrivate} />
        </div>

        <div className="w-full flex flex-col gap-1.5">
          <div className="flex justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: CASH_COLOR }} />
              <span className="text-muted-foreground">{t('widget.cashDrag.cash')}</span>
              {!isPrivate && data.totals.cashByCurrency.length > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="flex flex-col gap-0.5">
                      {data.totals.cashByCurrency.map((entry) => (
                        <span key={entry.currency} className="tabular-nums">
                          {formatCurrency(parseFloat(entry.value), entry.currency)}
                        </span>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <span className="text-foreground font-medium tabular-nums">
              {isPrivate ? '••••' : formatCurrency(cashValue, baseCurrency)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: INVESTED_COLOR }} />
              <span className="text-muted-foreground">{t('widget.cashDrag.invested')}</span>
            </div>
            <span className="text-foreground font-medium tabular-nums">
              {isPrivate ? '••••' : formatCurrency(securityValue, baseCurrency)}
            </span>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
