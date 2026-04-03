import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePortfolio } from '@/api/use-portfolio';
import { cn } from '@/lib/utils';
import { CostMethod } from '@quovibe/shared';
import { WidgetConfigProvider } from '@/context/widget-config-context';
import { CalculationBreakdownCard } from '@/components/domain/CalculationBreakdownCard';
import { FadeIn } from '@/components/shared/FadeIn';
import { useAnalyticsContext } from '@/context/analytics-context';

export default function Calculation() {
  const { t } = useTranslation('performance');
  const [preTax, setPreTax] = useState(true);
  const [costMethod, setCostMethod] = useState<CostMethod>(CostMethod.MOVING_AVERAGE);
  const { data: portfolio } = usePortfolio();
  const { setActions, setSubtitle } = useAnalyticsContext();

  useEffect(() => {
    const saved = portfolio?.config['portfolio.costMethod'];
    if (saved === CostMethod.FIFO || saved === CostMethod.MOVING_AVERAGE) {
      setCostMethod(saved);
    }
  }, [portfolio]);

  useEffect(() => {
    setSubtitle(t('calculation.subtitle'));
    return () => { setSubtitle(''); setActions(null); };
  }, [t, setSubtitle, setActions]);

  useEffect(() => {
    setActions(
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              costMethod === CostMethod.FIFO
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setCostMethod(CostMethod.FIFO)}
          >
            {t('calculation.costMethodFifo')}
          </button>
          <button
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              costMethod === CostMethod.MOVING_AVERAGE
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setCostMethod(CostMethod.MOVING_AVERAGE)}
          >
            {t('calculation.costMethodMa')}
          </button>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              preTax
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setPreTax(true)}
          >
            {t('calculation.preTax')}
          </button>
          <button
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              !preTax
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setPreTax(false)}
          >
            {t('calculation.afterTax')}
          </button>
        </div>
      </div>
    );
  }, [costMethod, preTax, t, setActions]);

  return (
    <FadeIn>
      <WidgetConfigProvider
        initialConfig={{
          dataSeries: { type: 'portfolio', preTax },
          periodOverride: null,
          options: { costMethod },
        }}
      >
        <CalculationBreakdownCard mode="full" />
      </WidgetConfigProvider>
    </FadeIn>
  );
}
