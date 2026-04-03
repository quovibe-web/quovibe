export interface DragMetricsInput {
  fees: number;
  taxes: number;
  initialValue: number;
  finalValue: number;
  periodDays: number;
}

export interface DragMetricsResult {
  grossReturn: number;
  gainsAvailable: boolean;
  feeGainsPct: number | null;
  taxGainsPct: number | null;
  totalGainsPct: number | null;
  feeExpenseRatio: number;
  taxExpenseRatio: number;
  shortPeriodWarning: boolean;
}

const SHORT_PERIOD_THRESHOLD = 30;

export function computeDragMetrics(input: DragMetricsInput): DragMetricsResult {
  const { fees, taxes, initialValue, finalValue, periodDays } = input;

  const grossReturn = (finalValue - initialValue) + fees + taxes;
  const gainsAvailable = grossReturn > 0;

  const feeGainsPct = gainsAvailable ? fees / grossReturn : null;
  const taxGainsPct = gainsAvailable ? taxes / grossReturn : null;
  const totalGainsPct = gainsAvailable ? (fees + taxes) / grossReturn : null;

  const avgPortfolioValue = (initialValue + finalValue) / 2;
  const annualizationFactor = periodDays > 0 ? 365 / periodDays : 0; // native-ok

  const feeExpenseRatio = avgPortfolioValue > 0
    ? (fees / avgPortfolioValue) * annualizationFactor
    : 0;
  const taxExpenseRatio = avgPortfolioValue > 0
    ? (taxes / avgPortfolioValue) * annualizationFactor
    : 0;

  return {
    grossReturn,
    gainsAvailable,
    feeGainsPct,
    taxGainsPct,
    totalGainsPct,
    feeExpenseRatio,
    taxExpenseRatio,
    shortPeriodWarning: periodDays < SHORT_PERIOD_THRESHOLD,
  };
}
