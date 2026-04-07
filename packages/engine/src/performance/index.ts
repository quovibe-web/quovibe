export type { DailySnapshot, TTWRORResult } from './ttwror';
export {
  carryForwardPrices,
  buildDailySnapshots,
  buildDailySnapshotsWithCarry,
  computeTTWROR,
} from './ttwror';

export { computeIRR } from './irr';
export { annualizeReturn } from './annualize';
export { simpleReturn } from './simple-return';
export type { MonthlyReturnEntry, YearlyReturnEntry, MonthlyReturnsResult } from './monthly-returns';
export { aggregateMonthlyReturns } from './monthly-returns';

export type { AbsolutePerformanceInput, AbsolutePerformanceResult } from './absolute-performance';
export { computeAbsolutePerformance } from './absolute-performance';
export type { MaxDrawdownInput, MaxDrawdownResult, DrawdownPoint, VolatilityInput, VolatilityResult } from './risk';
export { computeMaxDrawdown, computeDrawdownSeries, computeVolatility, computeSharpeRatio } from './risk';
export type { BenchmarkInput, BenchmarkDailyPoint } from './benchmark';
export { computeBenchmarkSeries } from './benchmark';
