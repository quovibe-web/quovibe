import Decimal from 'decimal.js';

export interface AbsolutePerformanceInput {
  mvb: Decimal;
  mve: Decimal;
  cfIn: Decimal;   // deposits + deliveryInbound in period
  cfOut: Decimal;  // removals + deliveryOutbound in period
}

export interface AbsolutePerformanceResult {
  value: Decimal;      // monetary
  percentage: Decimal; // value / (mvb + cfIn), 0 if denominator <= 0
}

export function computeAbsolutePerformance(
  input: AbsolutePerformanceInput,
): AbsolutePerformanceResult {
  const value = input.mve.minus(input.mvb).plus(input.cfOut).minus(input.cfIn);
  const invested = input.mvb.plus(input.cfIn);
  const percentage = invested.gt(0) ? value.div(invested) : new Decimal(0);
  return { value, percentage };
}
