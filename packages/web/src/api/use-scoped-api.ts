import { useContext } from 'react';
import { useParams } from 'react-router-dom';
import { PortfolioContext } from '@/context/PortfolioContext';
import { apiFetch } from './fetch';

/**
 * Resolves portfolioId and returns a fetch wrapper that prefixes every URL
 * with /api/p/:portfolioId/*. Also exposes the id for use in query keys.
 *
 * Resolution order: URL param → PortfolioContext → throw. The context
 * fallback exists so that user-level surfaces (e.g. /settings) can render
 * the full portfolio shell using the most-recently-opened portfolio as
 * context, without needing a :portfolioId segment in the URL.
 */
export function useScopedApi() {
  const { portfolioId: urlPortfolioId } = useParams<{ portfolioId: string }>();
  const contextPortfolio = useContext(PortfolioContext);
  const portfolioId = urlPortfolioId ?? contextPortfolio?.id;
  if (!portfolioId) throw new Error('useScopedApi: no :portfolioId in URL or context');
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
