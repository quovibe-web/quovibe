import { useParams } from 'react-router-dom';
import { apiFetch } from './fetch';

/**
 * Resolves portfolioId from the URL and returns a fetch wrapper that prefixes
 * every URL with /api/p/:portfolioId/*. Also exposes the id for use in query keys.
 */
export function useScopedApi() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  if (!portfolioId) throw new Error('useScopedApi: no :portfolioId in URL');
  return {
    portfolioId,
    fetch: <T,>(url: string, init?: RequestInit) => {
      const prefixed = url.startsWith('/api/')
        ? url.replace(/^\/api\//, `/api/p/${portfolioId}/`)
        : url;
      return apiFetch<T>(prefixed, init);
    },
    scopedUrl: (url: string) =>
      url.startsWith('/api/')
        ? url.replace(/^\/api\//, `/api/p/${portfolioId}/`)
        : url,
  };
}
