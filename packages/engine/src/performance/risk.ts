import Decimal from 'decimal.js';
import { differenceInCalendarDays, parseISO } from 'date-fns';

// Risk metrics: MDD, Volatility, Semivariance, Sharpe Ratio

export interface MaxDrawdownInput {
  date: string;
  cumulativeReturn: Decimal; // cumR from TTWROR (e.g., 0.05 = +5%)
}

export interface MaxDrawdownResult {
  maxDrawdown: Decimal;         // 0..1 range (e.g., 0.2144 = 21.44%)
  currentDrawdown: Decimal;     // drawdown at the last date relative to running peak
  peakDate: string | null;      // date of the peak before max drawdown
  troughDate: string | null;    // date of the trough (worst point)
  maxDrawdownDuration: number;  // longest time between two peaks (calendar days)
  recoveryTime: number;         // longest time from trough to next peak (calendar days)
  drawdownSeries: DrawdownPoint[]; // full daily drawdown time series
}

export interface DrawdownPoint {
  date: string;
  drawdown: Decimal; // 0..1 range, 0 at high-water mark, positive when below peak
}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/**
 * Computes all drawdown metrics in a single pass.
 *
 * Iterates through the accumulated performance series (1 + cumR).
 * Tracks running peak and computes drawdown = (peak - value) / peak.
 *
 * Returns:
 * - maxDrawdown: worst (largest) drawdown observed
 * - currentDrawdown: drawdown at the last date
 * - maxDrawdownDuration: longest time between two consecutive peaks (calendar days)
 * - recoveryTime: longest time from a trough back to the next peak (calendar days)
 * - drawdownSeries: full daily drawdown time series for charting
 *
 * @param dailyReturns Ordered array of { date, cumulativeReturn } from TTWROR
 */
export function computeMaxDrawdown(dailyReturns: MaxDrawdownInput[]): MaxDrawdownResult {
  if (dailyReturns.length <= 1) {
    return {
      maxDrawdown: ZERO,
      currentDrawdown: ZERO,
      peakDate: null,
      troughDate: null,
      maxDrawdownDuration: 0,
      recoveryTime: 0,
      drawdownSeries: dailyReturns.length === 1
        ? [{ date: dailyReturns[0].date, drawdown: ZERO }]
        : [],
    };
  }

  let maxDD = ZERO;
  let mddPeakDate: string | null = null;
  let mddTroughDate: string | null = null;

  // Duration tracking: longest time between two peaks
  let maxDuration = 0;

  // Recovery tracking: longest time from trough to next peak
  let maxRecovery = 0;
  let currentBottomDate: string | null = null;
  // Initialized to ZERO; safe because the `currentBottomDate === null` guard
  // in the OR short-circuits before this value is ever compared.
  let currentBottomValue: Decimal = ZERO;

  // Peak = highest accumulated performance value seen so far
  let peak = ONE.plus(dailyReturns[0].cumulativeReturn);
  let peakDate = dailyReturns[0].date;

  // Drawdown series (built in the same pass)
  const series: DrawdownPoint[] = [{ date: peakDate, drawdown: ZERO }];

  for (let i = 1; i < dailyReturns.length; i++) {
    const value = ONE.plus(dailyReturns[i].cumulativeReturn);
    const date = dailyReturns[i].date;

    // MDD uses strict > (not >=). Returning to the exact
    // previous peak is NOT a new high; the underwater period continues.
    if (value.gt(peak)) {
      // New peak reached — update duration tracking
      const duration = differenceInCalendarDays(parseISO(date), parseISO(peakDate));
      if (duration > maxDuration) {
        maxDuration = duration;
      }

      // Recovery tracking: if we were in a drawdown, measure recovery time
      if (currentBottomDate !== null) {
        const recovery = differenceInCalendarDays(parseISO(date), parseISO(currentBottomDate));
        if (recovery > maxRecovery) {
          maxRecovery = recovery;
        }
        currentBottomDate = null;
      }

      peak = value;
      peakDate = date;
      series.push({ date, drawdown: ZERO });
    } else {
      // In drawdown: compute drawdown = (peak - value) / peak
      const drawdown = peak.minus(value).div(peak);
      series.push({ date, drawdown });

      if (drawdown.gt(maxDD)) {
        maxDD = drawdown;
        mddPeakDate = peakDate;
        mddTroughDate = date;
      }

      // Track the bottom for recovery duration
      if (currentBottomDate === null || value.lt(currentBottomValue)) {
        currentBottomDate = date;
        currentBottomValue = value;
      }
    }
  }

  // Finalize duration if series never recovered to a new peak
  const lastDate = dailyReturns[dailyReturns.length - 1].date;
  const finalDuration = differenceInCalendarDays(parseISO(lastDate), parseISO(peakDate));
  if (finalDuration > maxDuration) {
    maxDuration = finalDuration;
  }

  // Current Drawdown: drawdown at the last date relative to the running peak.
  // If the last value equals or exceeds the peak, currentDrawdown = 0.
  const lastValue = ONE.plus(dailyReturns[dailyReturns.length - 1].cumulativeReturn);
  const currentDrawdown = lastValue.gt(peak) ? ZERO : peak.minus(lastValue).div(peak);

  return {
    maxDrawdown: maxDD,
    currentDrawdown,
    peakDate: mddPeakDate,
    troughDate: mddTroughDate,
    maxDrawdownDuration: maxDuration,
    recoveryTime: maxRecovery,
    drawdownSeries: series,
  };
}

/**
 * Computes only the daily drawdown time series (no summary stats).
 * Use computeMaxDrawdown().drawdownSeries when you need both.
 */
export function computeDrawdownSeries(dailyReturns: MaxDrawdownInput[]): DrawdownPoint[] {
  if (dailyReturns.length === 0) return [];

  const result: DrawdownPoint[] = [];
  let peak = ONE.plus(dailyReturns[0].cumulativeReturn);

  result.push({ date: dailyReturns[0].date, drawdown: ZERO });

  for (let i = 1; i < dailyReturns.length; i++) {
    const value = ONE.plus(dailyReturns[i].cumulativeReturn);

    if (value.gt(peak)) {
      peak = value;
      result.push({ date: dailyReturns[i].date, drawdown: ZERO });
    } else {
      result.push({ date: dailyReturns[i].date, drawdown: peak.minus(value).div(peak) });
    }
  }

  return result;
}

// ─── Volatility / Semivariance / Sharpe Ratio ────────────────────────────────

export interface VolatilityInput {
  r: Decimal; // simple daily return from TTWROR
}

export interface VolatilityResult {
  volatility: Decimal;        // annualized: stdDev * sqrt(n)
  semivariance: Decimal;      // annualized: semiStdDev * sqrt(n)
  standardDeviation: Decimal; // raw daily stdDev (pre-annualization)
}

/**
 * Computes volatility and semivariance using log-returns.
 *
 * 1. Convert simple returns to log-returns: logR = ln(1 + r)
 * 2. Mean of log-returns: avg = sum(logR) / n
 * 3. Sample variance (Bessel's correction): var = sum((logR - avg)^2) / (n - 1)
 * 4. Standard deviation: stdDev = sqrt(var)
 * 5. Annualize: volatility = stdDev * sqrt(n)
 *
 * Semivariance: same but only accumulates (logR - avg)^2 when logR < avg.
 * Denominator is still (n - 1) (total observations, not below-mean count).
 */
export function computeVolatility(dailyReturns: VolatilityInput[]): VolatilityResult {
  const n = dailyReturns.length;

  if (n < 2) {
    return {
      volatility: ZERO,
      semivariance: ZERO,
      standardDeviation: ZERO,
    };
  }

  // Two-pass algorithm (required: mean must be known before variance).
  // Pass 1: compute log-returns and their sum for the mean.
  // We store log-returns to avoid recomputing ln() in the second pass.
  let sum = ZERO;
  const logR = new Array<Decimal>(n);
  for (let i = 0; i < n; i++) {
    const lr = ONE.plus(dailyReturns[i].r).ln();
    logR[i] = lr;
    sum = sum.plus(lr);
  }
  const mean = sum.div(n);

  // Pass 2: sample variance + semivariance
  let varianceSum = ZERO;
  let semiVarianceSum = ZERO;
  for (let i = 0; i < n; i++) {
    const diff = logR[i].minus(mean);
    const diffSq = diff.pow(2);
    varianceSum = varianceSum.plus(diffSq);
    if (logR[i].lt(mean)) {
      semiVarianceSum = semiVarianceSum.plus(diffSq);
    }
  }

  const nMinus1 = new Decimal(n - 1);
  const variance = varianceSum.div(nMinus1);
  const semiVariance = semiVarianceSum.div(nMinus1);

  // Step 4: standard deviation
  const stdDev = variance.sqrt();
  const semiStdDev = semiVariance.sqrt();

  // Step 5: annualize — multiply by sqrt(n) where n = trading day count
  const sqrtN = new Decimal(n).sqrt();

  return {
    volatility: stdDev.times(sqrtN),
    semivariance: semiStdDev.times(sqrtN),
    standardDeviation: stdDev,
  };
}

/**
 * Sharpe Ratio = (IRR - riskFreeRate) / volatility
 *
 * Returns null when volatility is zero (undefined ratio).
 */
export function computeSharpeRatio(
  irr: Decimal,
  volatility: Decimal,
  riskFreeRate: Decimal,
): Decimal | null {
  if (volatility.isZero()) return null;
  return irr.minus(riskFreeRate).div(volatility);
}
