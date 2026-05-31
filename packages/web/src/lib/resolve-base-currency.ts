export function resolveBaseCurrency(
  config: Record<string, string | null | undefined> | undefined,
): string {
  return config?.['portfolio.currency'] || config?.['baseCurrency'] || 'EUR';
}
