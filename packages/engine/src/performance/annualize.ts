import Decimal from 'decimal.js';

/**
 * Annualises a cumulative return over a given number of calendar days.
 *
 * Formula (365 days/year convention):
 *   r_pa = (1 + r_cum) ^ (365 / periodDays) - 1
 *
 * Returns Decimal(0) when periodDays ≤ 0.
 */
export function annualizeReturn(cumReturn: Decimal, periodDays: number): Decimal {
  if (periodDays <= 0) return new Decimal(0);
  return cumReturn.plus(1).pow(new Decimal(365).div(periodDays)).minus(1);
}
