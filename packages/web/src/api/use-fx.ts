import { useQuery } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';

interface FxRateResponse {
  from: string;
  to: string;
  date: string;
  rate: string;
}

export function useFxRate(from: string | null, to: string | null, date: string | null) {
  const api = useScopedApi();
  const enabled = !!(from && to && date && from !== to);
  return useQuery({
    queryKey: ['portfolios', api.portfolioId, 'fx-rate', from, to, date],
    queryFn: () =>
      api.fetch<FxRateResponse>(
        `/api/prices/exchange-rates?from=${from}&to=${to}&date=${date}`,
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
