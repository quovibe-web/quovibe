import { CurrencyDisplay } from './CurrencyDisplay';
import { useForexView } from '@/context/forex-view-context';
import type { ForexSurface } from '@quovibe/shared';

interface Props {
  /** Base-currency value (always provided). */
  value: number;
  /** Base currency code. */
  currency: string;
  /** Native-currency value. Optional — when absent, always renders base. */
  nativeValue?: number | null;
  /** Native currency code. Optional — when absent, always renders base. */
  nativeCurrency?: string | null;
  /** Which forex surface preference to read. */
  forexSurface: ForexSurface;
  // Pass-through props for CurrencyDisplay:
  colorize?: boolean;
  /** Override sign for color: 1 = green, -1 = red. Omit to derive from value. */
  colorSign?: 1 | -1;
  className?: string;
  /** Override showCurrencyCode from display preferences. */
  showCurrencyCode?: boolean;
  /** Disable NumberFlow animation (render static text). */
  animated?: boolean;
}

/**
 * Renders a numeric value as either base or native currency based on the
 * user's per-surface forex-view preference. When native data is unavailable
 * or the native ccy matches base, always renders base.
 *
 * For callsites that aren't toggleable (e.g. plain currency display in a
 * non-financial context), use the underlying `<CurrencyDisplay>` directly.
 */
export function CurrencyDisplayWithToggle({
  value,
  currency,
  nativeValue,
  nativeCurrency,
  forexSurface,
  colorize,
  colorSign,
  className,
  showCurrencyCode,
  animated,
}: Props) {
  const { view } = useForexView(forexSurface);
  const hasNative =
    nativeValue != null && nativeCurrency != null && nativeCurrency !== currency;
  const useNative = view === 'native' && hasNative;
  return (
    <CurrencyDisplay
      value={useNative ? (nativeValue as number) : value}
      currency={useNative ? (nativeCurrency as string) : currency}
      colorize={colorize}
      colorSign={colorSign}
      className={className}
      showCurrencyCode={showCurrencyCode}
      animated={animated}
    />
  );
}
