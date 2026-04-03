import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { SearchResult, PreviewPricesResponse } from '@quovibe/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { InstrumentTypeBadge } from './InstrumentTypeBadge';
import { useChartColors } from '@/hooks/use-chart-colors';
import { formatDate } from '@/lib/formatters';

interface InstrumentDetailProps {
  result: SearchResult;
  previewData: PreviewPricesResponse | null;
  isPreviewLoading: boolean;
  isSaving: boolean;
  saveError: string | null;
  onBack: () => void;
  onAdd: () => void;
}

export function InstrumentDetail({
  result,
  previewData,
  isPreviewLoading,
  isSaving,
  saveError,
  onBack,
  onAdd,
}: InstrumentDetailProps) {
  const { t } = useTranslation('securities');
  const { palette } = useChartColors();

  const chartData = useMemo(() => {
    if (!previewData?.prices.length) return [];
    // Show last ~90 days for sparkline
    const prices = previewData.prices;
    const last90 = prices.slice(Math.max(0, prices.length - 90)); // native-ok
    return last90.map((p) => ({ date: p.date, close: parseFloat(p.close) }));
  }, [previewData]);

  const hasPrices = previewData && previewData.prices.length > 0;
  const firstDate = hasPrices ? previewData.prices[0].date : null;
  const lastDate = hasPrices ? previewData.prices[previewData.prices.length - 1].date : null; // native-ok

  return (
    <div className="qv-fade-in space-y-4">
      {/* Back link */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('addInstrument.backToResults')}
      </button>

      {/* Header: name + type badge */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-lg font-semibold truncate">{result.name}</h3>
          <InstrumentTypeBadge type={result.type} className="shrink-0" />
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          <span className="font-mono">{result.symbol}</span>
        </p>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <span className="text-muted-foreground">{t('addInstrument.currency')}</span>
          <p className="font-medium">{previewData?.currency ?? t('addInstrument.notAvailable')}</p>
        </div>
        <div>
          <span className="text-muted-foreground">{t('addInstrument.exchange')}</span>
          <p className="font-medium">{result.exchDisp ?? result.exchange}</p>
        </div>
        <div>
          <span className="text-muted-foreground">{t('addInstrument.type')}</span>
          <p className="font-medium">
            <InstrumentTypeBadge type={result.type} />
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">{t('addInstrument.sector')}</span>
          <p className="font-medium">{result.sector ?? t('addInstrument.notAvailable')}</p>
        </div>
      </div>

      {/* Price sparkline */}
      <div className="rounded-lg border p-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          {t('addInstrument.pricePreview')}
        </p>

        {isPreviewLoading && (
          <div className="space-y-2">
            <Skeleton className="h-[120px] w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        )}

        {!isPreviewLoading && hasPrices && (
          <>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={chartData}>
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke={palette[7] ?? palette[0]}
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">
              {t('addInstrument.priceCount', { count: previewData!.prices.length })}
              {firstDate && lastDate && (
                <> &middot; {t('addInstrument.priceRange', { start: formatDate(firstDate), end: formatDate(lastDate) })}</>
              )}
            </p>
          </>
        )}

        {!isPreviewLoading && !hasPrices && (
          <div className="flex flex-col items-center justify-center py-6 border-2 border-dashed rounded-md">
            <p className="text-sm text-muted-foreground">{t('addInstrument.noPrices')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('addInstrument.noPricesHint')}</p>
          </div>
        )}
      </div>

      {/* Error */}
      {saveError && (
        <p role="alert" className="text-sm text-destructive">{saveError}</p>
      )}

      {/* CTA */}
      <Button
        size="lg"
        className="w-full"
        onClick={onAdd}
        disabled={isSaving || isPreviewLoading}
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            {t('addInstrument.adding')}
          </>
        ) : hasPrices ? (
          t('addInstrument.addToPortfolio')
        ) : (
          t('addInstrument.addInstrument')
        )}
      </Button>
    </div>
  );
}
