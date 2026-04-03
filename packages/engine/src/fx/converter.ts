import Decimal from 'decimal.js';

export function convertAmount(
  amount: Decimal,
  rate: Decimal,
  direction: 'multiply' | 'divide',
): Decimal {
  if (direction === 'divide' && rate.isZero()) {
    throw new Error('Cannot divide by zero rate');
  }
  return direction === 'multiply' ? amount.mul(rate) : amount.div(rate);
}

/**
 * Converts an amount from foreign currency to base currency.
 * Uses multiply convention: foreignAmount × rate = baseAmount.
 *
 * FX conversion: foreignAmount × rate = baseAmount
 */
export function convertToBase(amount: Decimal, rate: Decimal): Decimal {
  return amount.mul(rate);
}

/**
 * Inverts an exchange rate: 1 / rate.
 * Useful when ECB provides EUR/foreign and you need foreign/EUR.
 */
export function invertRate(rate: Decimal): Decimal {
  if (rate.isZero()) {
    throw new Error('Cannot invert zero rate');
  }
  return new Decimal(1).div(rate);
}
