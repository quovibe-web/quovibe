import NumberFlow from '@number-flow/react';
import { usePrivacy } from '@/context/privacy-context';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
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
  currency = 'EUR',
  colorize = false,
  colorSign,
  className,
  showCurrencyCode: showCurrencyCodeProp,
  animated = true,
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

  if (isPrivate) {
    return <span className={cn('tabular-nums', colorClass, className)}>••••••</span>;
  }

  const currencyCode = currency || 'EUR';

  if (showCurrencyCode) {
    return (
      <span className={cn('tabular-nums', colorClass, className)}>
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
    );
  }

  return (
    <span className={cn('tabular-nums', colorClass, className)}>
      <NumberFlow
        className="muted-fraction"
        value={value}
        animated={animated}
        locales={i18n.language}
        format={{
          style: 'currency',
          currency: currencyCode,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }}
      />
    </span>
  );
}
