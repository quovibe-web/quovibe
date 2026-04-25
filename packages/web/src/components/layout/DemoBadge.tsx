// packages/web/src/components/layout/DemoBadge.tsx
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { PortfolioContext } from '@/context/PortfolioContext';
import { Beaker } from 'lucide-react';

export function DemoBadge() {
  const { t } = useTranslation('switcher');
  const portfolio = useContext(PortfolioContext);
  if (!portfolio || portfolio.kind !== 'demo') return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary md:px-2">
      <Beaker className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="sr-only md:not-sr-only">{t('demoBadge')}</span>
    </span>
  );
}
