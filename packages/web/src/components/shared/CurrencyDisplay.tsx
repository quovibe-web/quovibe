import NumberFlow from '@number-flow/react';
import { usePrivacy } from '@/context/privacy-context';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

interface CurrencyDisplayProps {
  value: number;
  currency?: string | null;
  colorize?: boolean;
  /** Override sign for color: 1 = green, -1 = red. Omit to derive from value. */
  colorSign?: 1 | -1;
  className?: string;
  /** Override showCurrencyCode from display preferences */
  showCurrencyCode?: boolean;
  /** Disable NumberFlow animation (render static text) */
  animated?: boolean;
}

export function CurrencyDisplay({
  value,
  currency,
  colorize = false,
  colorSign,
  className,
  showCurrencyCode: showCurrencyCodeProp,
  animated = true,
}: CurrencyDisplayProps) {
  const { isPrivate } = usePrivacy();
  const { showCurrencyCode: showCurrencyCodePref } = useDisplayPreferences();
  const baseCurrency = useBaseCurrency();
  const showCurrencyCode = showCurrencyCodeProp ?? showCurrencyCodePref;

  const colorClass =
    !isPrivate && colorize
      ? (colorSign ?? value) > 0
        ? 'text-[var(--qv-positive)]'
        : (colorSign ?? value) < 0
          ? 'text-[var(--qv-negative)]'
          : undefined
      : undefined;

  if (isPrivate) {
    return <span className={cn('tabular-nums', colorClass, className)}>••••••</span>;
  }

  const currencyCode = currency || baseCurrency;
  // Plain-text form — carries the value for screen readers, find-in-page, copy-paste,
  // and textContent. NumberFlow's shadow DOM is invisible to all four.
  const plainText = formatCurrency(value, currencyCode, { showCurrencyCode });

  if (showCurrencyCode) {
    return (
      <span className={cn('tabular-nums', colorClass, className)} aria-label={plainText}>
        <span aria-hidden="true">
          <NumberFlow
            className="muted-fraction"
            value={value}
            animated={animated}
            locales={i18n.language}
            format={{
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }}
          />
          {' '}{currencyCode}
        </span>
        <span className="sr-only">{plainText}</span>
      </span>
    );
  }

  return (
    <span className={cn('tabular-nums', colorClass, className)} aria-label={plainText}>
      <NumberFlow
        className="muted-fraction"
        value={value}
        animated={animated}
        locales={i18n.language}
        aria-hidden="true"
        format={{
          style: 'currency',
          currency: currencyCode,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }}
      />
      <span className="sr-only">{plainText}</span>
    </span>
  );
}
