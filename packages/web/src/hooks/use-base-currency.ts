import { usePortfolio } from '@/api/use-portfolio';
import { resolveBaseCurrency } from '@/lib/resolve-base-currency';

export function useBaseCurrency(): string {
  const { data } = usePortfolio();
  return resolveBaseCurrency(data?.config);
}
