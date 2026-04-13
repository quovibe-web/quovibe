import type { StatementOfAssetsResponse } from '@/api/types';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { usePrivacy } from '@/context/privacy-context';

type CashByCurrencyEntry = StatementOfAssetsResponse['totals']['cashByCurrency'][number];

interface CashBreakdownProps {
  cashByCurrency: CashByCurrencyEntry[];
  className?: string;
}

export function CashBreakdown({ cashByCurrency, className }: CashBreakdownProps) {
  const { isPrivate } = usePrivacy();

  if (cashByCurrency.length <= 1) return null;

  return (
    <div className={className}>
      {cashByCurrency.map((entry, i) => (
        <span key={entry.currency} className="text-xs text-muted-foreground tabular-nums">
          {i > 0 && <span className="mx-1 text-border">·</span>}
          {isPrivate ? '••••••' : (
            <>
              {entry.currency}{' '}
              <CurrencyDisplay
                value={parseFloat(entry.value)}
                currency={entry.currency}
                className="text-xs text-muted-foreground"
                animated={false}
              />
            </>
          )}
        </span>
      ))}
    </div>
  );
}
