// Pure helpers for PortfolioSetupForm. Extracted so the form's invariants are
// testable under the web package's node-env vitest setup (no DOM testing
// library — rendered behaviour is verified in Phase 7 Playwright scenarios).
//
// BUG-54/55 Phase 3 — Task 3.3.

import type { SetupPortfolioInput } from '@quovibe/shared';

export interface FormValues {
  baseCurrency: string;
  securitiesAccountName: string;
  primaryDeposit: { name: string };
  extraDeposits?: Array<{ name: string; currency: string }>;
}

/**
 * Returns the canonical (lower-case, trimmed) form of every name that appears
 * more than once across the primary + extras list. Empty / whitespace-only
 * entries are ignored. Result is deduplicated.
 *
 * Used by PortfolioSetupForm's submit gate to surface a form-level error
 * before the wire payload reaches the server (the server enforces the same
 * invariant via accounts.service.assertUniqueAccountName, returning
 * DUPLICATE_NAME → 409 — the client check is a UX shortcut, not a
 * security boundary).
 */
export function findDuplicateDepositNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dups: string[] = [];
  for (const [key, count] of seen) {
    if (count > 1) dups.push(key);
  }
  return dups;
}

/**
 * Normalises raw react-hook-form state into the `SetupPortfolioInput` wire
 * shape: trims account names, defaults `extraDeposits` to `[]`, passes
 * currency through verbatim (the schema regex validates the format at the
 * wire boundary).
 */
export function buildSetupInput(values: FormValues): SetupPortfolioInput {
  return {
    baseCurrency: values.baseCurrency,
    securitiesAccountName: values.securitiesAccountName.trim(),
    primaryDeposit: { name: values.primaryDeposit.name.trim() },
    extraDeposits: (values.extraDeposits ?? []).map(d => ({
      name: d.name.trim(),
      currency: d.currency,
    })),
  };
}
