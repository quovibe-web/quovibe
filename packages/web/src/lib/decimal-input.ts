/**
 * Normalize a user-typed decimal string to the dot form the wire schemas and
 * `parseFloat` expect.
 *
 * Comma-locale users (es/it/de/fr/nl/pl/pt) type "1,5" while the app *displays*
 * the locale comma — input must accept it too. Comma and dot are the ONLY
 * decimal separators across the 8 shipped locales, so a literal comma->dot
 * replace is locale-agnostic.
 *
 * Deliberately NOT the inverse of `formatNumber`: this never strips thousands
 * grouping. A grouped input "1.234,56" becomes "1.234.56" and is left for the
 * downstream numeric grammar to *reject* rather than being silently corrected
 * to 1234.56. The same property keeps it corruption-safe on edit round-trips —
 * an already-dot value from the API ("18.18") passes through unchanged.
 *
 * Single source of truth for the manual-price form (`price-history-form.schema`)
 * and the transaction form (`transaction-form.schema` + `transaction-payload`).
 */
export function normalizeDecimalInput(raw: string): string {
  return raw.trim().replace(/,/g, '.');
}
