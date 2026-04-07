import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaSeries, LineSeries,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { TaxonomyNodePicker } from '@/components/domain/TaxonomyNodePicker';
import { useTaxonomies } from '@/api/use-taxonomies';
import { useTaxonomySeries } from '@/api/use-taxonomy-series';
import { usePortfolio, useUpdateSettings } from '@/api/use-portfolio';
import { formatPercentage, formatCurrency } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useLightweightChart } from '@/hooks/use-lightweight-chart';
import { cn } from '@/lib/utils';
import { getSavedChartType, withAlpha, type ChartSeriesType } from '@/lib/chart-types';
import { ChartToolbar } from '@/components/shared/ChartToolbar';
import { ChartLegendOverlay, type LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { BarChart3 } from 'lucide-react';

// ─── Chart mode ──────────────────────────────────────────────────────────────

type ChartMode = 'mv' | 'ttwror';

const CHART_ID = 'taxonomy-series';

// ─── Metric tile ─────────────────────────────────────────────────────────────

interface MetricTileProps {
  label: string;
  children: React.ReactNode;
}

function MetricTile({ label, children }: MetricTileProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TaxonomySeries() {
  const { t } = useTranslation('reports');
  const { t: tNav } = useTranslation('navigation');
  const { data: taxonomies, isLoading: taxonomiesLoading } = useTaxonomies();
  const { isPrivate } = usePrivacy();
  const { profit, loss, palette } = useChartColors();
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | undefined>(undefined);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('ttwror');
  const [chartType, setChartType] = useState<ChartSeriesType>(
    () => getSavedChartType(CHART_ID) ?? 'area',
  );
  const { data: portfolioData } = usePortfolio();
  const { mutate: saveSettings, isPending: savePending } = useUpdateSettings();

  // Auto-select taxonomy on load using sidecar preference, falling back to first
  useEffect(() => {
    if (!taxonomies || !portfolioData || selectedTaxonomyId) return;
    const savedId = portfolioData.config['defaultDataSeriesTaxonomyId'];
    const validSaved = savedId && taxonomies.some((tx) => tx.id === savedId);
    setSelectedTaxonomyId(validSaved ? savedId : taxonomies[0]?.id);
  }, [taxonomies, portfolioData, selectedTaxonomyId]);

  const categoryIdsArray = useMemo(
    () => (selectedCategoryId ? [selectedCategoryId] : []),
    [selectedCategoryId],
  );

  function handleTaxonomyChange(id: string) {
    setSelectedTaxonomyId(id);
    setSelectedCategoryId(null);
    saveSettings({ defaultDataSeriesTaxonomyId: id });
  }

  const { data: slices, isLoading: slicesLoading } = useTaxonomySeries(
    selectedTaxonomyId,
    categoryIdsArray,
  );

  const slice = slices?.[0] ?? null;

  const sliceColor = slice ? (slice.color ?? palette[0]) : palette[0];

  // Derive key metrics
  const ttwror = slice ? parseFloat(slice.ttwror) : 0;
  const ttwrorPa = slice ? parseFloat(slice.ttwrorPa) : 0;
  const irr = slice?.irr !== null ? parseFloat(slice?.irr ?? '0') : null;
  const mvb = slice ? parseFloat(slice.mvb) : 0;
  const mve = slice ? parseFloat(slice.mve) : 0;
  const gain = slice ? parseFloat(slice.absoluteGain) : 0;
  const dividends = slice ? parseFloat(slice.dividends) : 0;
  const fees = slice ? parseFloat(slice.fees) : 0;

  // ─── Lightweight Charts ────────────────────────────────────────────────────

  const { containerRef, chartRef, ready } = useLightweightChart({
    options: {
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      leftPriceScale: { visible: false },
    },
  });

  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // Incremented after each series rebuild to trigger a re-render so legendItems pick up
  // the fresh seriesRef.current (refs don't cause re-renders on their own).
  const [seriesVersion, setSeriesVersion] = useState(0);

  // Build chart data for current mode
  const chartData = useMemo(() => {
    if (!slice) return [];
    return [...slice.chartData]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({
        time: p.date as string,
        value: parseFloat(chartMode === 'mv' ? p.marketValue : p.ttwrorCumulative),
      }));
  }, [slice, chartMode]);

  // Create or recreate the series when chart type, chart mode, color, or data changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || !chartData.length) return;

    // Remove existing series (guard: chart may be destroyed during unmount)
    try {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
    } catch { seriesRef.current = null; return; }

    let series: ISeriesApi<SeriesType>;

    switch (chartType) {
      case 'line':
        series = chart.addSeries(LineSeries, {
          color: sliceColor,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        break;
      case 'area':
      default:
        series = chart.addSeries(AreaSeries, {
          lineColor: sliceColor,
          topColor: withAlpha(sliceColor, 0.25),
          bottomColor: 'transparent',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        break;
    }

    series.setData(chartData);
    chart.timeScale().fitContent();
    seriesRef.current = series;
    setSeriesVersion((v) => v + 1); // native-ok — triggers re-render to refresh legendItems
  }, [chartType, chartMode, sliceColor, chartData]);

  // Format value for legend crosshair display
  const formatLegendValue = (v: number) =>
    chartMode === 'mv' ? formatCurrency(v) : formatPercentage(v);

  // Build legend items — depends on seriesVersion so it re-derives after every series rebuild
  const legendItems: LegendSeriesItem[] = seriesVersion > 0 && seriesRef.current && slice
    ? [
        {
          id: 'taxonomy-series',
          label: slice.categoryName,
          color: sliceColor,
          series: seriesRef.current,
          visible: true,
          formatValue: formatLegendValue,
        },
      ]
    : [];

  function handleTypeChange(type: ChartSeriesType) {
    setChartType(type);
  }

  return (
    <div className="qv-page space-y-6">
      <PageHeader
        title={tNav('items.dataSeries')}
        subtitle={t('taxonomySeries.subtitle')}
      />
      {taxonomiesLoading ? (
        <Skeleton className="h-8 w-full rounded-lg" />
      ) : !taxonomies || taxonomies.length === 0 ? (
        <EmptyState icon={BarChart3} title={t('taxonomySeries.noTaxonomies')} />
      ) : (
      <>
      {/* Taxonomy selector + Category chips */}
      <div className="space-y-3">
        {taxonomies.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              {t('taxonomySeries.selectTaxonomy')}
            </span>
            <Select
              value={selectedTaxonomyId ?? ''}
              onValueChange={handleTaxonomyChange}
              disabled={savePending}
            >
              <SelectTrigger className="h-8 w-48 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {taxonomies.map((tx) => (
                  <SelectItem key={tx.id} value={tx.id}>
                    {tx.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedTaxonomyId && (
          <TaxonomyNodePicker
            taxonomyId={selectedTaxonomyId}
            selectedId={selectedCategoryId}
            onSelectionChange={setSelectedCategoryId}
          />
        )}
      </div>

      {/* Empty state */}
      {!selectedCategoryId && (
        <EmptyState icon={BarChart3} title={t('taxonomySeries.selectCategory')} />
      )}

      {/* Chart + Metrics */}
      {selectedCategoryId && (
        <FadeIn>
        <Card style={{ animation: 'qv-stagger-in 0.5s ease-out both', animationDelay: '120ms' }}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-4">
              {/* Left: category name + headline metric */}
              <div className="flex items-center gap-4 min-w-0">
                <div
                  className="w-1 h-8 rounded-full shrink-0"
                  style={{ backgroundColor: sliceColor }}
                />
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">
                    {slice?.categoryName ?? '…'}
                  </CardTitle>
                  {slice && !slicesLoading && (
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span
                        className="text-xl font-semibold tabular-nums"
                        style={{ color: !isPrivate ? (ttwror >= 0 ? profit : loss) : undefined }}
                      >
                        {isPrivate ? '••••••' : formatPercentage(ttwror)}
                      </span>
                      <span className="text-xs text-muted-foreground">{t('taxonomySeries.ttwror')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: segmented toggle */}
              <div className="flex items-center rounded-lg border border-border p-0.5 shrink-0">
                <button
                  onClick={() => setChartMode('ttwror')}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                    chartMode === 'ttwror'
                      ? 'bg-[var(--qv-surface-elevated)] text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t('taxonomySeries.ttwrorPercent')}
                </button>
                <button
                  onClick={() => setChartMode('mv')}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                    chartMode === 'mv'
                      ? 'bg-[var(--qv-surface-elevated)] text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t('taxonomySeries.marketValue')}
                </button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {slicesLoading ? (
              <div className="h-[320px]">
                <Skeleton className="w-full h-full rounded-lg" />
              </div>
            ) : (
              <>
                {/* Chart */}
                <div className="flex items-center justify-between mb-1">
                  <ChartLegendOverlay
                    chart={chartRef.current}
                    items={legendItems}
                  />
                  <ChartToolbar
                    chartId={CHART_ID}
                    activeType={chartType}
                    hasOhlc={false}
                    onTypeChange={handleTypeChange}
                  />
                </div>
                <div
                  className="relative"
                  style={{
                    height: 320,
                    filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
                    transition: 'filter 0.2s ease',
                  }}
                >
                  <div ref={containerRef} className="w-full h-full" />
                </div>

                {/* Metric tiles grid */}
                {slice && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-border">
                    <MetricTile label={t('taxonomySeries.ttwrorPa')}>
                      <span
                        className="text-sm font-semibold tabular-nums"
                        style={{ color: !isPrivate ? (ttwrorPa >= 0 ? profit : loss) : undefined }}
                      >
                        {isPrivate ? '••••••' : formatPercentage(ttwrorPa)}
                      </span>
                    </MetricTile>

                    <MetricTile label={t('taxonomySeries.irr')}>
                      {irr !== null ? (
                        <span
                          className="text-sm font-semibold tabular-nums"
                          style={{ color: !isPrivate ? (irr >= 0 ? profit : loss) : undefined }}
                        >
                          {isPrivate ? '••••••' : formatPercentage(irr)}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </MetricTile>

                    <MetricTile label={t('taxonomySeries.mvb')}>
                      <CurrencyDisplay value={mvb} className="text-sm font-semibold tabular-nums" />
                    </MetricTile>

                    <MetricTile label={t('taxonomySeries.mve')}>
                      <CurrencyDisplay value={mve} className="text-sm font-semibold tabular-nums" />
                    </MetricTile>

                    <MetricTile label={t('taxonomySeries.gain')}>
                      <CurrencyDisplay value={gain} colorize className="text-sm font-semibold tabular-nums" />
                    </MetricTile>

                    <MetricTile label={t('taxonomySeries.dividends')}>
                      <CurrencyDisplay value={dividends} className="text-sm font-semibold tabular-nums" />
                    </MetricTile>

                    <MetricTile label={t('taxonomySeries.fees')}>
                      <CurrencyDisplay value={fees} className="text-sm font-semibold tabular-nums" />
                    </MetricTile>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        </FadeIn>
      )}
    </>
      )}
    </div>
  );
}
