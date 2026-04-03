import { formatCurrency } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
import { cn } from '@/lib/utils';

interface CurrencyDisplayProps {
  value: number;
  currency?: string | null;
  colorize?: boolean;
  /** Override sign for color: 1 = green, -1 = red. Omit to derive from value. */
  colorSign?: 1 | -1;
  className?: string;
  /** Override showCurrencyCode from display preferences */
  showCurrencyCode?: boolean;
}

export function CurrencyDisplay({
  value,
  currency = 'EUR',
  colorize = false,
  colorSign,
  className,
  showCurrencyCode: showCurrencyCodeProp,
}: CurrencyDisplayProps) {
  const { isPrivate } = usePrivacy();
  const { showCurrencyCode: showCurrencyCodePref } = useDisplayPreferences();
  const showCurrencyCode = showCurrencyCodeProp ?? showCurrencyCodePref;

  const colorClass =
    !isPrivate && colorize
      ? (colorSign ?? value) > 0
        ? 'text-[var(--qv-positive)]'
        : (colorSign ?? value) < 0
          ? 'text-[var(--qv-negative)]'
          : undefined
      : undefined;

  return (
    <span className={cn('tabular-nums', colorClass, className)}>
      {isPrivate ? '••••••' : formatCurrency(value, currency, { showCurrencyCode })}
    </span>
  );
}
