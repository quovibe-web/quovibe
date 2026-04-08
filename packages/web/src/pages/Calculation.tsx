import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePortfolio } from '@/api/use-portfolio';
import { CostMethod } from '@quovibe/shared';
import { WidgetConfigProvider } from '@/context/widget-config-context';
import { CalculationBreakdownCard } from '@/components/domain/CalculationBreakdownCard';
import { FadeIn } from '@/components/shared/FadeIn';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
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
        <SegmentedControl
          segments={[
            { value: CostMethod.FIFO, label: t('calculation.costMethodFifo') },
            { value: CostMethod.MOVING_AVERAGE, label: t('calculation.costMethodMa') },
          ]}
          value={costMethod}
          onChange={setCostMethod}
        />
        <SegmentedControl
          segments={[
            { value: 'pretax', label: t('calculation.preTax') },
            { value: 'aftertax', label: t('calculation.afterTax') },
          ]}
          value={preTax ? 'pretax' : 'aftertax'}
          onChange={(v) => setPreTax(v === 'pretax')}
        />
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
