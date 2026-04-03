import { createContext, useContext, type ReactNode } from 'react';

interface AnalyticsContextValue {
  setActions: (node: ReactNode) => void;
  setSubtitle: (text: string) => void;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function useAnalyticsContext(): AnalyticsContextValue {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error('useAnalyticsContext must be used within Analytics layout');
  return ctx;
}

export { AnalyticsContext };
