import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetch';

interface FxRateResponse {
  from: string;
  to: string;
  date: string;
  rate: string;
}

export function useFxRate(from: string | null, to: string | null, date: string | null) {
  const enabled = !!(from && to && date && from !== to);
  return useQuery({
    queryKey: ['fx-rate', from, to, date],
    queryFn: () =>
      apiFetch<FxRateResponse>(
        `/api/prices/exchange-rates?from=${from}&to=${to}&date=${date}`,
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
