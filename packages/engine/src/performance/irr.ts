import Decimal from 'decimal.js';
import { differenceInCalendarDays, parseISO } from 'date-fns';

/**
 * IRR formula:
 *
 *   MVB × (1+IRR)^(RD/365) + Σ CF_t × (1+IRR)^(RD_t/365) = MVE
 *
 * where RD = total period days, RD_t = remaining days from CF date to period end.
 * Positive CF = inflow (buy), negative CF = outflow (sell / dividend).
 *
 * Convergence strategy:
 *   1. Newton-Raphson (guess = 0.1, up to maxIterations)
 *   2. Brent's method (bisection, bounds [-0.999, 10.0])
 *   3. null — never returns a wrong value
 *
 * Optimisation: all inner loop arithmetic uses native floats.
 * Decimal is only used for the final result.
 */
export function computeIRR(params: {
  mvb: Decimal;
  mve: Decimal;
  cashflows: Array<{ date: string; amount: Decimal }>;
  periodStart: string;
  periodEnd: string;
  maxIterations?: number;
  tolerance?: number;
}): Decimal | null {
  const {
    mvb,
    mve,
    cashflows,
    periodStart,
    periodEnd,
    maxIterations = 100,
    tolerance = 1e-10,
  } = params;

  const totalDays = differenceInCalendarDays(parseISO(periodEnd), parseISO(periodStart));
  if (totalDays <= 0) return new Decimal(0);

  // Convert to native floats for the hot loop
  const mvbN = mvb.toNumber();
  const mveN = mve.toNumber();
  const totalExp = totalDays / 365; // native-ok: time exponent, not a financial amount

  const cfs = cashflows.map((cf) => ({
    rd: differenceInCalendarDays(parseISO(periodEnd), parseISO(cf.date)) / 365, // native-ok
    amount: cf.amount.toNumber(),
  }));

  // f(irr) = MVB*(1+irr)^RD + Σ CF_t*(1+irr)^RD_t - MVE
  function f(irr: number): number {
    let val = mvbN * Math.pow(1 + irr, totalExp); // native-ok
    for (const cf of cfs) {
      val += cf.amount * Math.pow(1 + irr, cf.rd); // native-ok
    }
    return val - mveN;
  }

  // f'(irr)
  function fPrime(irr: number): number {
    let der = mvbN * totalExp * Math.pow(1 + irr, totalExp - 1); // native-ok
    for (const cf of cfs) {
      der += cf.amount * cf.rd * Math.pow(1 + irr, cf.rd - 1); // native-ok
    }
    return der;
  }

  // Attempt 1: Newton-Raphson
  let irr = 0.1;
  for (let i = 0; i < maxIterations; i++) {
    const fv = f(irr);
    const fp = fPrime(irr);
    if (fp === 0) break;
    const next = irr - fv / fp;
    if (Math.abs(next - irr) < tolerance) {
      return new Decimal(next.toPrecision(15));
    }
    irr = next;
    // Guard against divergence to ±Infinity
    if (!isFinite(irr)) break;
  }

  // Attempt 2: Brent's method (bisection hybrid) — converges if solution exists in [lo, hi]
  const lo = -0.999;
  const hi = 10.0;
  const fLo = f(lo);
  const fHi = f(hi);

  // No root bracket: no solution in [-99.9%, +1000%]
  if (Math.sign(fLo) === Math.sign(fHi)) return null;

  let a = lo;
  let b = hi;
  let fA = fLo;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < tolerance || (b - a) / 2 < tolerance) {
      return new Decimal(mid.toPrecision(15));
    }
    if (Math.sign(fMid) === Math.sign(fA)) {
      a = mid;
      fA = fMid;
    } else {
      b = mid;
    }
  }

  return null; // no convergence
}
