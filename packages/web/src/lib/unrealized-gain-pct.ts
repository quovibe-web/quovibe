/**
 * Unrealized gain percentage for the currency view actually on screen.
 *
 * The security surfaces render the unrealized figure through
 * `CurrencyDisplayWithToggle`, so the number beside the percentage is either
 * the base-currency or the native-currency one. The percentage has to follow
 * the same switch: pairing a base-currency amount with a native-currency ratio
 * reads as a contradiction, and for a cross-currency position the two can even
 * carry opposite signs.
 *
 * The `hasNative` rule is copied from `CurrencyDisplayWithToggle` on purpose —
 * both must fall back to base under exactly the same conditions.
 */
export interface UnrealizedGainPctInput {
  /** Current forex view for the surface. */
  view: 'base' | 'native';
  /** Unrealized gain and cost basis in base currency (always present). */
  unrealizedBase: string;
  costBase: string;
  /** Unrealized gain and cost basis in the security's own currency. */
  unrealizedNative: string;
  purchaseValueNative: string;
  baseCurrency: string;
  nativeCurrency: string | null | undefined;
}

/** Returns the fractional gain (0.05 = +5 %), or null when it has no meaning. */
export function resolveUnrealizedGainPct(input: UnrealizedGainPctInput): number | null {
  const hasNative =
    input.nativeCurrency != null && input.nativeCurrency !== input.baseCurrency;
  const useNative = input.view === 'native' && hasNative;

  const gain = parseFloat(useNative ? input.unrealizedNative : input.unrealizedBase);
  const cost = parseFloat(useNative ? input.purchaseValueNative : input.costBase);

  if (!Number.isFinite(gain) || !Number.isFinite(cost) || cost === 0) return null;
  return gain / cost;
}
