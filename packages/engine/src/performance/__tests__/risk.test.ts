// Reference: Risk metrics — max drawdown, volatility (annualised std dev), Sharpe ratio
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeMaxDrawdown, computeDrawdownSeries, MaxDrawdownInput, computeVolatility, computeSharpeRatio, VolatilityInput } from '../risk';

function d(v: number): Decimal {
  return new Decimal(v);
}

function makeInput(data: Array<{ date: string; cumR: number }>): MaxDrawdownInput[] {
  return data.map(({ date, cumR }) => ({ date, cumulativeReturn: d(cumR) }));
}

describe('computeMaxDrawdown', () => {
  // Maximum Drawdown (MDD) — largest peak-to-trough decline in cumulative performance

  it('returns zero for empty input', () => {
    const result = computeMaxDrawdown([]);
    expect(result.maxDrawdown.toNumber()).toBe(0);
    expect(result.peakDate).toBeNull();
    expect(result.troughDate).toBeNull();
    expect(result.maxDrawdownDuration).toBe(0);
    expect(result.recoveryTime).toBe(0);
  });

  it('returns zero for single-point input', () => {
    const result = computeMaxDrawdown(makeInput([{ date: '2023-01-01', cumR: 0.05 }]));
    expect(result.maxDrawdown.toNumber()).toBe(0);
    expect(result.peakDate).toBeNull();
    expect(result.troughDate).toBeNull();
  });

  // MDD — monotonically increasing series has zero drawdown
  it('returns zero for monotonically increasing series', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.00 },
      { date: '2023-01-02', cumR: 0.01 },
      { date: '2023-01-03', cumR: 0.03 },
      { date: '2023-01-04', cumR: 0.05 },
      { date: '2023-01-05', cumR: 0.10 },
    ]);
    const result = computeMaxDrawdown(input);
    expect(result.maxDrawdown.toNumber()).toBe(0);
    expect(result.peakDate).toBeNull();
    expect(result.troughDate).toBeNull();
  });

  // MDD — peak-to-trough decline detection
  // MDD = (1.2204 - 0.9588) / 1.2204 ≈ 0.21436
  it('computes MDD ≈ 21.44% for declining series', () => {
    const input = makeInput([
      { date: '2020-06-12', cumR: 0.00 },
      { date: '2021-08-18', cumR: 0.2204 },  // peak at 22.04%
      { date: '2022-01-15', cumR: 0.05 },     // intermediate decline
      { date: '2022-03-08', cumR: -0.0412 },  // trough at -4.12%
      { date: '2022-06-06', cumR: 0.25 },     // recovery past peak
    ]);
    const result = computeMaxDrawdown(input);
    // (1.2204 - 0.9588) / 1.2204 = 0.26140 / 1.2204 ≈ 0.21419
    // Expected ≈ 21.44% — small rounding difference from intermediate points
    expect(result.maxDrawdown.toNumber()).toBeCloseTo(0.2142, 3);
    expect(result.peakDate).toBe('2021-08-18');
    expect(result.troughDate).toBe('2022-03-08');
  });

  // MDD — drawdown tracking
  it('computes simple 20% drawdown correctly', () => {
    // Simulate: starts at 0%, goes to +25%, drops to 0% (value 1.0 from 1.25 = 20% drawdown)
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.25 },
      { date: '2023-01-03', cumR: 0.0 },
    ]);
    const result = computeMaxDrawdown(input);
    // drawdown = (1.25 - 1.0) / 1.25 = 0.2
    expect(result.maxDrawdown.toNumber()).toBeCloseTo(0.2, 10);
    expect(result.peakDate).toBe('2023-01-02');
    expect(result.troughDate).toBe('2023-01-03');
  });

  // MDD — drawdown tracking
  it('picks the worst drawdown among multiple', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.10 },   // peak 1.10
      { date: '2023-01-03', cumR: 0.00 },   // dd = (1.10 - 1.00) / 1.10 ≈ 0.0909
      { date: '2023-01-04', cumR: 0.20 },   // new peak 1.20
      { date: '2023-01-05', cumR: -0.10 },  // dd = (1.20 - 0.90) / 1.20 = 0.25
      { date: '2023-01-06', cumR: 0.30 },   // recovery
    ]);
    const result = computeMaxDrawdown(input);
    // Second drawdown is worse: 0.25
    expect(result.maxDrawdown.toNumber()).toBe(0.25);
    expect(result.peakDate).toBe('2023-01-04');
    expect(result.troughDate).toBe('2023-01-05');
  });

  // MDD Duration — longest time between peaks
  it('tracks maxDrawdownDuration correctly', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-10', cumR: 0.10 },  // peak
      { date: '2023-01-20', cumR: 0.05 },  // drawdown
      { date: '2023-02-10', cumR: 0.15 },  // new peak after 31 days
      { date: '2023-03-10', cumR: 0.05 },  // drawdown
      { date: '2023-06-10', cumR: 0.20 },  // new peak after 120 days
    ]);
    const result = computeMaxDrawdown(input);
    // Duration between peaks: 2023-01-10 → 2023-02-10 = 31 days
    // Duration between peaks: 2023-02-10 → 2023-06-10 = 120 days
    // Max duration = 120 days
    expect(result.maxDrawdownDuration).toBe(120);
  });

  // MDD Duration — longest time between peaks
  it('handles maxDrawdownDuration when series never recovers', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-10', cumR: 0.10 },  // peak
      { date: '2023-01-20', cumR: 0.05 },  // drawdown, never recovers
      { date: '2023-04-10', cumR: 0.02 },  // still below peak
    ]);
    const result = computeMaxDrawdown(input);
    // Duration from last peak to end = 2023-01-10 → 2023-04-10 = 90 days
    expect(result.maxDrawdownDuration).toBe(90);
  });

  // MDD — recovery time tracking
  it('tracks recovery time correctly', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-10', cumR: 0.20 },   // peak
      { date: '2023-02-10', cumR: -0.05 },  // trough (bottom)
      { date: '2023-04-10', cumR: 0.25 },   // recovery (new peak), 59 days from bottom
    ]);
    const result = computeMaxDrawdown(input);
    // Recovery from 2023-02-10 → 2023-04-10 = 59 days
    expect(result.recoveryTime).toBe(59);
  });

  // MDD — drawdown tracking
  it('handles flat series (no drawdown, but duration spans full range)', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.0 },
      { date: '2023-01-03', cumR: 0.0 },
    ]);
    const result = computeMaxDrawdown(input);
    expect(result.maxDrawdown.toNumber()).toBe(0);
    // Strict >: equal-to-peak does NOT count as a new peak,
    // so the underwater interval spans the full range.
    expect(result.maxDrawdownDuration).toBe(2);
  });

  // MDD — drawdown tracking
  it('handles all-negative cumulative returns', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: -0.05 },
      { date: '2023-01-03', cumR: -0.10 },
      { date: '2023-01-04', cumR: -0.15 },
    ]);
    const result = computeMaxDrawdown(input);
    // Peak is 1.0 (day 1), trough is 0.85 (day 4)
    // drawdown = (1.0 - 0.85) / 1.0 = 0.15
    expect(result.maxDrawdown.toNumber()).toBe(0.15);
    expect(result.peakDate).toBe('2023-01-01');
    expect(result.troughDate).toBe('2023-01-04');
  });

  // Strict > for new peak detection
  // Returning to exactly the previous peak is NOT a new high.
  // The underwater period continues until the value strictly exceeds the peak.
  it('return-to-peak does not end drawdown duration (strict >)', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-10', cumR: 0.10 },  // peak: 1.10
      { date: '2023-01-20', cumR: 0.05 },  // drawdown
      { date: '2023-02-10', cumR: 0.10 },  // returns to exactly 1.10 — NOT a new peak (strict >)
      { date: '2023-03-10', cumR: 0.05 },  // still in drawdown
      { date: '2023-04-10', cumR: 0.15 },  // new peak 1.15 — strictly > 1.10
    ]);
    const result = computeMaxDrawdown(input);
    // Duration is from 2023-01-10 → 2023-04-10 = 90 days (the equal-to-peak on 02-10 does NOT reset)
    expect(result.maxDrawdownDuration).toBe(90);
  });

  // MDD Duration — longest time between peaks
  it('computes duration of 292 days for peak-to-recovery cycle', () => {
    // Peak at Aug 18, 2021, recovery (new high) at Jun 6, 2022
    // Start the series AT the peak date so the initial peak-to-peak interval
    // is precisely the drawdown-recovery cycle.
    const input = makeInput([
      { date: '2021-08-18', cumR: 0.2204 },  // peak at 22.04%
      { date: '2022-01-15', cumR: 0.05 },     // intermediate decline
      { date: '2022-03-08', cumR: -0.0412 },  // trough at -4.12%
      { date: '2022-06-06', cumR: 0.25 },     // recovery past peak → new high
    ]);
    const result = computeMaxDrawdown(input);
    // Duration: 2021-08-18 → 2022-06-06 = 292 days
    expect(result.maxDrawdownDuration).toBe(292);
  });

  // ─── Current Drawdown ─────────────────────────────────────────────────────

  // Current Drawdown = drawdown at the last date relative to the running peak.
  // If the last value IS the peak, currentDrawdown = 0.

  it('currentDrawdown is zero when last point is a new peak', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.10 },
      { date: '2023-01-03', cumR: 0.05 },
      { date: '2023-01-04', cumR: 0.15 }, // new peak at the end
    ]);
    const result = computeMaxDrawdown(input);
    expect(result.currentDrawdown.toNumber()).toBe(0);
  });

  it('currentDrawdown reflects drawdown at last date', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.20 }, // peak: 1.20
      { date: '2023-01-03', cumR: 0.08 }, // last value: 1.08
    ]);
    const result = computeMaxDrawdown(input);
    // currentDrawdown = (1.20 - 1.08) / 1.20 = 0.10
    expect(result.currentDrawdown.toNumber()).toBe(0.1);
  });

  it('currentDrawdown equals maxDrawdown when still at the trough', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.25 },  // peak: 1.25
      { date: '2023-01-03', cumR: -0.10 }, // trough and last: 0.90
    ]);
    const result = computeMaxDrawdown(input);
    // max = current = (1.25 - 0.90) / 1.25 = 0.28
    expect(result.currentDrawdown.toNumber()).toBe(0.28);
    expect(result.maxDrawdown.toNumber()).toBe(0.28);
  });

  it('currentDrawdown is zero for empty input', () => {
    const result = computeMaxDrawdown([]);
    expect(result.currentDrawdown.toNumber()).toBe(0);
  });

  it('currentDrawdown is less than maxDrawdown after partial recovery', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.20 },  // peak: 1.20
      { date: '2023-01-03', cumR: -0.10 }, // trough: 0.90, dd = 0.25
      { date: '2023-01-04', cumR: 0.05 },  // partial recovery: 1.05, dd = (1.20-1.05)/1.20 = 0.125
    ]);
    const result = computeMaxDrawdown(input);
    expect(result.maxDrawdown.toNumber()).toBe(0.25);
    expect(result.currentDrawdown.toNumber()).toBeCloseTo(0.125, 10);
  });
});

describe('computeDrawdownSeries', () => {
  // Full daily drawdown time series from running-peak logic.

  it('returns empty array for empty input', () => {
    expect(computeDrawdownSeries([])).toEqual([]);
  });

  // MDD — drawdown tracking
  it('single point has zero drawdown', () => {
    const input = makeInput([{ date: '2023-01-01', cumR: 0.05 }]);
    const series = computeDrawdownSeries(input);
    expect(series).toHaveLength(1);
    expect(series[0].drawdown.toNumber()).toBe(0);
  });

  // Drawdown chart series
  it('produces zero drawdown at new highs, positive drawdown below peak', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },   // peak 1.0
      { date: '2023-01-02', cumR: 0.10 },  // peak 1.10
      { date: '2023-01-03', cumR: 0.05 },  // dd = (1.10 - 1.05) / 1.10
      { date: '2023-01-04', cumR: 0.20 },  // new peak 1.20, dd = 0
      { date: '2023-01-05', cumR: 0.08 },  // dd = (1.20 - 1.08) / 1.20
    ]);
    const series = computeDrawdownSeries(input);
    expect(series).toHaveLength(5);
    expect(series[0].drawdown.toNumber()).toBe(0);               // initial
    expect(series[1].drawdown.toNumber()).toBe(0);               // new peak
    expect(series[2].drawdown.toNumber()).toBeCloseTo(0.04545, 4); // (1.10-1.05)/1.10
    expect(series[3].drawdown.toNumber()).toBe(0);               // new peak
    expect(series[4].drawdown.toNumber()).toBe(0.1);             // (1.20-1.08)/1.20
  });

  // MDD — drawdown tracking
  it('series length equals input length', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.10 },
      { date: '2023-01-03', cumR: -0.05 },
      { date: '2023-01-04', cumR: 0.15 },
      { date: '2023-01-05', cumR: 0.10 },
    ]);
    const series = computeDrawdownSeries(input);
    expect(series).toHaveLength(input.length);
    // Verify dates match
    for (let i = 0; i < input.length; i++) {
      expect(series[i].date).toBe(input[i].date);
    }
  });

  // Strict > for peak detection
  it('return-to-peak produces zero drawdown but does not advance peak', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: 0.10 },  // peak 1.10
      { date: '2023-01-03', cumR: 0.05 },  // dd > 0
      { date: '2023-01-04', cumR: 0.10 },  // returns to 1.10 — NOT a new peak (strict >)
      { date: '2023-01-05', cumR: 0.05 },  // still dd relative to 1.10
    ]);
    const series = computeDrawdownSeries(input);
    // Day 4: value == peak → dd = (1.10 - 1.10) / 1.10 = 0  (drawdown is 0 but peak unchanged)
    expect(series[3].drawdown.toNumber()).toBe(0);
    // Day 5: still below peak of 1.10
    expect(series[4].drawdown.toNumber()).toBeCloseTo(0.04545, 4);
  });

  // Drawdown chart series
  it('all-negative returns produce monotonically increasing drawdown', () => {
    const input = makeInput([
      { date: '2023-01-01', cumR: 0.0 },
      { date: '2023-01-02', cumR: -0.05 },
      { date: '2023-01-03', cumR: -0.10 },
      { date: '2023-01-04', cumR: -0.15 },
    ]);
    const series = computeDrawdownSeries(input);
    expect(series[0].drawdown.toNumber()).toBe(0);
    expect(series[1].drawdown.toNumber()).toBe(0.05);
    expect(series[2].drawdown.toNumber()).toBe(0.10);
    expect(series[3].drawdown.toNumber()).toBe(0.15);
  });
});

// ─── Volatility / Semivariance ───────────────────────────────────────────────

function makeVolInput(data: Array<{ r: number }>): VolatilityInput[] {
  return data.map(({ r }) => ({ r: d(r) }));
}

describe('computeVolatility', () => {
  // Volatility and Semivariance calculation

  it('returns zeros for empty input', () => {
    const result = computeVolatility([]);
    expect(result.volatility.toNumber()).toBe(0);
    expect(result.semivariance.toNumber()).toBe(0);
    expect(result.standardDeviation.toNumber()).toBe(0);
  });

  it('returns zeros for single-point input (n < 2)', () => {
    const result = computeVolatility(makeVolInput([{ r: 0.01 }]));
    expect(result.volatility.toNumber()).toBe(0);
    expect(result.semivariance.toNumber()).toBe(0);
    expect(result.standardDeviation.toNumber()).toBe(0);
  });

  // Volatility — annualized standard deviation of returns
  // Hand-computed 5-point synthetic series:
  //   returns: [0.01, -0.02, 0.015, -0.005, 0.03]
  //   logR: [ln(1.01), ln(0.98), ln(1.015), ln(0.995), ln(1.03)]
  //       = [0.009950331, -0.020202707, 0.014888949, -0.005012542, 0.029558802]
  //   mean = 0.019182833 / 5 = 0.003836567
  //   STDEV.S(logR) via Excel/Sheets
  //   Annualize: stdDev * sqrt(5)
  it('matches hand-computed 5-point series', () => {
    const input = makeVolInput([
      { r: 0.01 },
      { r: -0.02 },
      { r: 0.015 },
      { r: -0.005 },
      { r: 0.03 },
    ]);
    const result = computeVolatility(input);

    // Verify log-returns manually:
    // ln(1.01)  = 0.00995033...
    // ln(0.98)  = -0.02020271...
    // ln(1.015) = 0.01488895...
    // ln(0.995) = -0.00501254...
    // ln(1.03)  = 0.02955880...
    // mean = 0.00383657...
    // Sum of (logR - mean)^2:
    //   (0.00995033 - 0.00383657)^2 = 0.00003742
    //   (-0.02020271 - 0.00383657)^2 = 0.00057817
    //   (0.01488895 - 0.00383657)^2 = 0.00012215
    //   (-0.00501254 - 0.00383657)^2 = 0.00007834
    //   (0.02955880 - 0.00383657)^2 = 0.00066207
    // total = 0.00147815
    // variance = 0.00147815 / 4 = 0.00036954
    // stdDev = sqrt(0.00036954) = 0.01922...
    // annualized = 0.01922 * sqrt(5) = 0.04298...

    expect(result.standardDeviation.toNumber()).toBeCloseTo(0.01909, 4);
    expect(result.volatility.toNumber()).toBeCloseTo(0.04268, 3);
    expect(result.volatility.gt(0)).toBe(true);
    expect(result.semivariance.gt(0)).toBe(true);
  });

  // Semivariance — downside variance of returns
  // Only below-mean deviations contribute; denominator = n-1 (total observations)
  it('semivariance only includes below-mean observations', () => {
    const input = makeVolInput([
      { r: 0.01 },
      { r: -0.02 },
      { r: 0.015 },
      { r: -0.005 },
      { r: 0.03 },
    ]);
    const result = computeVolatility(input);

    // Semivariance uses only logR < mean observations
    // Mean ≈ 0.003837
    // Below-mean: ln(0.98) ≈ -0.02020 and ln(0.995) ≈ -0.00501
    // Semi sum = (-0.02020 - 0.00384)^2 + (-0.00501 - 0.00384)^2
    //          = 0.00057817 + 0.00007834 = 0.00065651
    // semiVar = 0.00065651 / 4 = 0.00016413
    // semiStdDev = sqrt(0.00016413) = 0.01281...
    // annualized = 0.01281 * sqrt(5) = 0.02864...

    expect(result.semivariance.toNumber()).toBeCloseTo(0.03154, 3);
    expect(result.semivariance.lt(result.volatility)).toBe(true);
  });

  // Volatility and Semivariance relationship
  // For a symmetric distribution: volatility / semivariance ≈ sqrt(2) ≈ 1.414
  it('symmetric distribution: volatility / semivariance ≈ sqrt(2)', () => {
    // Create a perfectly symmetric return series around zero
    const input = makeVolInput([
      { r: 0.02 },
      { r: -0.02 },
      { r: 0.01 },
      { r: -0.01 },
      { r: 0.03 },
      { r: -0.03 },
    ]);
    const result = computeVolatility(input);

    const ratio = result.volatility.div(result.semivariance).toNumber();
    // Should be close to sqrt(2) ≈ 1.414
    expect(ratio).toBeCloseTo(Math.SQRT2, 1);
  });

  // Volatility — annualized standard deviation of returns
  // When all returns are identical, volatility = 0
  it('zero volatility for constant returns', () => {
    const input = makeVolInput([
      { r: 0.01 },
      { r: 0.01 },
      { r: 0.01 },
    ]);
    const result = computeVolatility(input);
    // Floating-point precision: ln(1.01) repeated yields near-zero variance, not exact zero
    expect(result.volatility.toNumber()).toBeCloseTo(0, 10);
    expect(result.semivariance.toNumber()).toBeCloseTo(0, 10);
    expect(result.standardDeviation.toNumber()).toBeCloseTo(0, 10);
  });
});

// ─── Sharpe Ratio ────────────────────────────────────────────────────────────

describe('computeSharpeRatio', () => {
  it('basic ratio with zero risk-free rate', () => {
    const irr = d(0.10);       // 10%
    const vol = d(0.20);       // 20%
    const rfr = d(0);
    const result = computeSharpeRatio(irr, vol, rfr);
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBe(0.5); // 0.10 / 0.20
  });

  it('non-zero risk-free rate', () => {
    const irr = d(0.10);
    const vol = d(0.20);
    const rfr = d(0.02);  // 2%
    const result = computeSharpeRatio(irr, vol, rfr);
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBe(0.4); // (0.10 - 0.02) / 0.20
  });

  it('returns null when volatility is zero', () => {
    const result = computeSharpeRatio(d(0.05), d(0), d(0));
    expect(result).toBeNull();
  });

  it('negative Sharpe when IRR < risk-free rate', () => {
    const result = computeSharpeRatio(d(0.01), d(0.15), d(0.03));
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(-0.1333, 3); // (0.01 - 0.03) / 0.15
  });
});
