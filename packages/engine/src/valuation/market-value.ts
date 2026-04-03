import Decimal from 'decimal.js';

/**
 * Computes the total market value of a position.
 *
 *   marketValue = shares × price
 */
export function computeMarketValue(shares: Decimal, price: Decimal): Decimal {
  return shares.mul(price);
}
