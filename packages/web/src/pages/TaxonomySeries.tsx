import { useState, useMemo, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
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
import { formatPercentage, formatCurrency, formatDate } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useChartTheme } from '@/hooks/use-chart-theme';
import { useChartTicks } from '@/hooks/use-chart-ticks';
import { cn } from '@/lib/utils';
import { ChartTooltip, ChartTooltipRow } from '@/components/shared/ChartTooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { BarChart3 } from 'lucide-react';

// ─── Chart mode ──────────────────────────────────────────────────────────────

type ChartMode = 'mv' | 'ttwror';

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
  const { t, i18n } = useTranslation('reports');
  const { t: tNav } = useTranslation('navigation');
  const { data: taxonomies, isLoading: taxonomiesLoading } = useTaxonomies();
  const { isPrivate } = usePrivacy();
  const { profit, loss, palette } = useChartColors();
  const { gridColor, gridOpacity, tickColor, cursorColor, cursorDasharray } = useChartTheme();
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | undefined>(undefined);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('ttwror');
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

  const chartData = useMemo(() => {
    if (!slice) return [];
    return [...slice.chartData]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({
        date: p.date,
        value: parseFloat(chartMode === 'mv' ? p.marketValue : p.ttwrorCumulative),
      }));
  }, [slice, chartMode]);

  const chartDates = useMemo(() => chartData.map((d) => d.date), [chartData]);
  const { ticks: chartTicks, tickFormatter } = useChartTicks(chartDates);

  const uid = useId();
  const gradientId = `colorAreaTax-${uid.replace(/:/g, '')}`;

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
                <div style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none', transition: 'filter 0.2s ease' }}>
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 40, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={sliceColor} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={sliceColor} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={gridOpacity} vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: tickColor, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        ticks={chartTicks}
                        tickFormatter={tickFormatter}
                      />
                      <YAxis
                        tick={{ fill: tickColor, fontSize: 11, style: { fontFeatureSettings: '"tnum"' } }}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={4}
                        tickFormatter={(v: number) =>
                          chartMode === 'mv'
                            ? new Intl.NumberFormat(i18n.language, {
                                notation: 'compact',
                                maximumFractionDigits: 1,
                              }).format(v)
                            : formatPercentage(v)
                        }
                      />
                      <Tooltip
                        cursor={{ stroke: cursorColor, strokeDasharray: cursorDasharray }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const val = payload[0].value as number;
                          const formatted = chartMode === 'mv'
                            ? formatCurrency(val)
                            : formatPercentage(val);
                          return (
                            <ChartTooltip label={formatDate(label as string)}>
                              <ChartTooltipRow
                                color={sliceColor}
                                label={slice?.categoryName ?? ''}
                                value={formatted}
                              />
                            </ChartTooltip>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="none"
                        fill={`url(#${gradientId})`}
                        dot={false}
                        animationDuration={800}
                        animationEasing="ease-out"
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={sliceColor}
                        strokeWidth={2.5}
                        dot={false}
                        animationDuration={800}
                        animationEasing="ease-out"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
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
