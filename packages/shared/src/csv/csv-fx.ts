// packages/shared/src/csv/csv-fx.ts
//
// CSV cross-currency rate-direction bridge.
//
// The CSV wire `Exchange Rate` column is in **deposit-per-security**
// convention: `Gross Amount × Exchange Rate = Value` where Gross is in
// security ccy and Value is in deposit ccy.
//
// Quovibe's internal `fxRate` (consumed by `transaction.service.ts` and the
// `xact_unit.exchangeRate` column via `buildUnits`) is in
// **security-per-deposit** convention: `getRate(deposit, security)` returns
// security-units-per-deposit-unit, and `gross_dep = gross_sec / fxRate_qv`.
//
// Reciprocals: `wire_rate × fxRate_qv = 1`. The CSV-parse boundary inverts
// once via `ppRateToQvRate` so the rest of the pipeline (mapper, FOREX
// unit) stays byte-identical with `transaction.service.ts`. Single source
// of truth — do not re-derive.

/**
 * Inverts a wire-style CSV exchange rate (deposit-per-security) into the
 * quovibe-internal convention (security-per-deposit).
 *
 * @returns the inverted rate, or `null` when the input is not a positive
 *   finite number (callers surface this as `INVALID_FX_RATE`).
 */
export function ppRateToQvRate(ppRate: number): number | null {
  if (!Number.isFinite(ppRate) || ppRate <= 0) return null;
  return 1 / ppRate;
}

/**
 * Wire-side `Gross × Rate = Value` consistency check (the wizard step-2
 * gate). Returns `true` when
 * `|grossSec × ppRate − valueDep| ≤ tolerance × max(|valueDep|, 1)`.
 *
 * Tolerance defaults to `5e-4` (0.05 %) — loose enough to absorb the rounding
 * users perform when transcribing rates onto a CSV (e.g. 4-decimal rate ×
 * 2-decimal currency), tight enough to reject genuine direction or magnitude
 * errors. The denominator floor of 1 prevents tolerance from collapsing to
 * zero on near-zero values.
 */
export function verifyGrossRateValue(
  grossSec: number,
  ppRate: number,
  valueDep: number,
  tolerance: number = 5e-4,
): boolean {
  if (!Number.isFinite(grossSec) || !Number.isFinite(ppRate) || !Number.isFinite(valueDep)) {
    return false;
  }
  const expected = grossSec * ppRate;
  const diff = Math.abs(expected - valueDep);
  const denom = Math.max(Math.abs(valueDep), 1);
  return diff <= tolerance * denom;
}
