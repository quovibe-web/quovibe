/**
 * Resolves the currency to use when creating a new security via CSV import.
 *
 * Priority (highest first):
 *   1. User override from the per-row currency picker (truthy string only;
 *      empty string is treated as "no override").
 *   2. Single distinct CGA value seen in the CSV for this security.
 *   3. Portfolio reference-deposit currency (silent fallback).
 *
 * Multi-CGA conflicts intentionally fall through to (3) — the UI surfaces
 * a warning and asks the user to pick explicitly via the override.
 */
export function resolveNewSecurityCurrency(
  csvCurrencies: string[],
  portfolioCurrency: string,
  override: string | undefined,
): string {
  if (override) return override;
  if (csvCurrencies.length === 1) return csvCurrencies[0];
  return portfolioCurrency;
}
