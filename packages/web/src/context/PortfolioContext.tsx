import { createContext, useContext } from 'react';

export interface PortfolioSummary {
  id: string;
  name: string;
  kind: 'real' | 'demo';
}

export const PortfolioContext = createContext<PortfolioSummary | null>(null);

export function usePortfolio(): PortfolioSummary {
  const v = useContext(PortfolioContext);
  if (!v) throw new Error('usePortfolio must be used inside <PortfolioLayout>');
  return v;
}
