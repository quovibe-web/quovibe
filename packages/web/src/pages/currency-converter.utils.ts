// Pure helpers for the CurrencyConverter page. Extracted so they can be
// unit-tested under the web package's node-env vitest setup without
// pulling the full React tree (React Query, FormProvider, lucide icons,
// shadcn primitives, etc.) into the test module graph.

/**
 * Build the user-facing union of currency codes shown in the From/To
 * pickers: the static ISO-4217 subset PLUS any code already present in
 * the server's pair summary (so portfolios with exotic legacy rates
 * stay navigable). Sorted alphabetically, deduped.
 */
export function buildCurrencyOptions(
  baseList: ReadonlyArray<{ code: string }>,
  extra: ReadonlyArray<string>,
): string[] {
  const set = new Set<string>(baseList.map(c => c.code));
  for (const c of extra) set.add(c);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Swap a (from, to) currency pair. */
export function swapPair(from: string, to: string): { from: string; to: string } {
  return { from: to, to: from };
}
