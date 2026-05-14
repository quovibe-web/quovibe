/**
 * Append a location search (e.g. "?periodStart=…") to a React-Router redirect
 * target. Targets must be path-only (no `?…` of their own) — this helper is
 * for URL aliases that need to preserve the user's current query string.
 */
export function appendSearch(to: string, search: string): string {
  return `${to}${search}`;
}
