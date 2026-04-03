import { useMemo } from 'react';
import { usePortfolio } from '@/api/use-portfolio';

export interface DisplayPreferences {
  showCurrencyCode: boolean;
  showPaSuffix: boolean;
  sharesPrecision: number;
  quotesPrecision: number;
}

const DEFAULTS: DisplayPreferences = {
  showCurrencyCode: false,
  showPaSuffix: true,
  sharesPrecision: 1,
  quotesPrecision: 2,
};

export function useDisplayPreferences(): DisplayPreferences {
  const { data: portfolio } = usePortfolio();

  const rawShowCurrencyCode = portfolio?.config['showCurrencyCode'];
  const rawShowPaSuffix = portfolio?.config['showPaSuffix'];
  const rawSharesPrecision = portfolio?.config['sharesPrecision'];
  const rawQuotesPrecision = portfolio?.config['quotesPrecision'];

  return useMemo(() => {
    if (!portfolio?.config) return DEFAULTS;
    return {
      showCurrencyCode: rawShowCurrencyCode === 'true',
      showPaSuffix: rawShowPaSuffix !== 'false',
      sharesPrecision: parseInt(rawSharesPrecision ?? '1', 10) || 1,
      quotesPrecision: parseInt(rawQuotesPrecision ?? '2', 10) || 2,
    };
  }, [portfolio?.config, rawShowCurrencyCode, rawShowPaSuffix, rawSharesPrecision, rawQuotesPrecision]);
}
