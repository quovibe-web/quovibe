export interface PickerSecurity {
  id: string;
  name: string;
  ticker: string | null;
  isin: string | null;
  isRetired: boolean;
}

export function filterSecurities(
  securities: PickerSecurity[],
  query: string,
): PickerSecurity[] {
  const q = query.trim().toLowerCase();
  if (!q) return securities;
  return securities.filter((s) => {
    const parts = [s.name, s.ticker, s.isin].filter((p): p is string => Boolean(p));
    return parts.join(' ').toLowerCase().includes(q);
  });
}
