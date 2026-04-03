import Decimal from 'decimal.js';

/**
 * All rates use multiply convention: foreignAmount × rate = baseAmount.
 */
export interface CurrencyGainsInput {
  /** Shares × currentPrice in foreign currency */
  nativeValue: Decimal;
  /** Shares × purchasePrice in foreign currency */
  nativeCost: Decimal;
  /** FX rate at purchase (foreign→base, multiply convention) */
  purchaseRate: Decimal;
  /** FX rate at valuation date (foreign→base, multiply convention) */
  currentRate: Decimal;
}

export interface CurrencyGainsResult {
  /** Total gain in base currency */
  totalGain: Decimal;
  /** Pure price component (evaluated at current rate) */
  priceGain: Decimal;
  /** Pure FX component (applied to cost basis) */
  currencyEffect: Decimal;
}

/**
 * Decomposes total gain into price gain and currency effect.
 *
 * FX gain/loss decomposition.
 * Currency effect is computed on the COST BASIS:
 *   currencyEffect = nativeCost × (currentRate − purchaseRate)
 *   priceGain = (nativeValue − nativeCost) × currentRate
 *   totalGain = priceGain + currencyEffect
 */
export function computeCurrencyGains(input: CurrencyGainsInput): CurrencyGainsResult {
  const { nativeValue, nativeCost, purchaseRate, currentRate } = input;

  const totalGain = nativeValue.mul(currentRate).minus(nativeCost.mul(purchaseRate));
  const priceGain = nativeValue.minus(nativeCost).mul(currentRate);
  const currencyEffect = nativeCost.mul(currentRate.minus(purchaseRate));

  return { totalGain, priceGain, currencyEffect };
}

/**
 * Computes FX gain/loss on a foreign-currency cash balance.
 * With multiply convention: balance × (rateEnd − rateStart)
 */
export function computeCashCurrencyGain(
  balance: Decimal,
  rateStart: Decimal,
  rateEnd: Decimal,
): Decimal {
  return balance.mul(rateEnd.minus(rateStart));
}
