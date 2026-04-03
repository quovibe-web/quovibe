import Decimal from 'decimal.js';

/**
 * Simple Rate of Return: r = MVE / MVB - 1
 *
 * Returns Decimal(0) when MVB is zero (no starting capital).
 */
export function simpleReturn(mve: Decimal, mvb: Decimal): Decimal {
  if (mvb.isZero()) return new Decimal(0);
  return mve.div(mvb).minus(1);
}
