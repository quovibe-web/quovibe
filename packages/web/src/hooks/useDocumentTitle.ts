import { useEffect } from 'react';
import { usePortfolio } from '@/context/PortfolioContext';

/**
 * Sets document.title to `<portfolio> · <page> · quovibe` whenever the
 * enclosing portfolio or the page name changes. Must be called inside a
 * portfolio-scoped route (i.e. under `<PortfolioLayout>`).
 */
export function useDocumentTitle(pageName: string): void {
  const portfolio = usePortfolio();
  useEffect(() => {
    document.title = `${portfolio.name} · ${pageName} · quovibe`;
  }, [portfolio.name, pageName]);
}
