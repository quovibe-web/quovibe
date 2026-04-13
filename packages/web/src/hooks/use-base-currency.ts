import { usePortfolio } from '@/api/use-portfolio';

export function useBaseCurrency(): string {
  const { data } = usePortfolio();
  return data?.config?.['portfolio.currency'] ?? 'EUR';
}
