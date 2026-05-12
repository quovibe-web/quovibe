import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavTitle } from '@/hooks/useNavTitle';
import {
  AreaSeries, LineSeries,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SignedPercent } from '@/components/shared/SignedPercent';
import { SummaryStrip } from '@/components/shared/SummaryStrip';
import { useTaxonomies } from '@/api/use-taxonomies';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import { useTaxonomySeries } from '@/api/use-taxonomy-series';
import { usePortfolio } from '@/api/use-portfolio';
import { useUpdatePreferences } from '@/api/use-preferences';
import { formatPercentage } from '@/lib/formatters';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useLightweightChart } from '@/hooks/use-lightweight-chart';
import { getSavedChartType, type ChartSeriesType } from '@/lib/chart-types';
import { buildSeriesOptions } from '@/lib/chart-series-factory';
import { ChartToolbar } from '@/components/shared/ChartToolbar';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { ChartLegendOverlay, type LegendSeriesItem } from '@/components/shared/ChartLegendOverlay';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { translateTaxonomyName } from '@/lib/taxonomy-i18n';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaxonomySliceResponse, TaxonomyTreeCategory } from '@/api/types';

// ─── Chart mode ──────────────────────────────────────────────────────────────

type ChartMode = 'mv' | 'ttwror';

const CHART_ID = 'taxonomy-series';
const MAX_CATEGORIES = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FlatCategoryNode {
  id: string;
  name: string;
  color: string | null;
  depth: number;
  parentId: string | null;
}

function flattenTree(categories: TaxonomyTreeCategory[], depth = 0, parentId: string | null = null): FlatCategoryNode[] {
  const out: FlatCategoryNode[] = [];
  for (const cat of categories) {
    out.push({ id: cat.id, name: cat.name, color: cat.color, depth, parentId });
    if (cat.children.length > 0) {
      out.push(...flattenTree(cat.children, depth + 1, cat.id));
    }
  }
  return out;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TaxonomySeries() {
  const { t } = useTranslation('reports');
  const { t: tNav } = useTranslation('navigation');
  useNavTitle('taxonomySeries');
  const { data: taxonomies, isLoading: taxonomiesLoading } = useTaxonomies();
  const { isPrivate } = usePrivacy();
  const baseCurrency = useBaseCurrency();
  const { palette } = useChartColors();
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | undefined>(undefined);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('ttwror');
  const [chartType, setChartType] = useState<ChartSeriesType>(
    () => getSavedChartType(CHART_ID) ?? 'area',
  );
  const { data: portfolioData } = usePortfolio();
  const { mutate: saveSettings, isPending: savePending } = useUpdatePreferences();

  // Auto-select taxonomy on load using sidecar preference, falling back to first
  useEffect(() => {
    if (!taxonomies || !portfolioData || selectedTaxonomyId) return;
    const savedId = portfolioData.config['defaultDataSeriesTaxonomyId'];
    const validSaved = savedId && taxonomies.some((tx) => tx.id === savedId);
    setSelectedTaxonomyId(validSaved ? savedId : taxonomies[0]?.id);
  }, [taxonomies, portfolioData, selectedTaxonomyId]);

  const { data: tree, isLoading: treeLoading } = useTaxonomyTree(selectedTaxonomyId);

  const flatNodes = useMemo<FlatCategoryNode[]>(() => {
    if (!tree) return [];
    return flattenTree(tree.categories);
  }, [tree]);

  const allCategoryIds = useMemo(
    () => flatNodes.map((n) => n.id).slice(0, MAX_CATEGORIES),
    [flatNodes],
  );

  // Auto-select first category once tree resolves
  useEffect(() => {
    if (!selectedCategoryId && flatNodes.length > 0) {
      setSelectedCategoryId(flatNodes[0].id);
    }
  }, [flatNodes, selectedCategoryId]);

  const { data: slices, isLoading: slicesLoading } = useTaxonomySeries(
    selectedTaxonomyId,
    allCategoryIds,
  );

  const slicesById = useMemo(() => {
    const map = new Map<string, TaxonomySliceResponse>();
    for (const s of slices ?? []) map.set(s.categoryId, s);
    return map;
  }, [slices]);

  const selectedSlice = selectedCategoryId ? slicesById.get(selectedCategoryId) ?? null : null;
  const sliceColor = selectedSlice ? (selectedSlice.color ?? palette[0]) : palette[0];

  // Derived metrics for selected category
  const ttwror = selectedSlice ? parseFloat(selectedSlice.ttwror) : 0;
  const ttwrorPa = selectedSlice ? parseFloat(selectedSlice.ttwrorPa) : 0;
  const irr = selectedSlice?.irr != null ? parseFloat(selectedSlice.irr) : null;
  const mve = selectedSlice ? parseFloat(selectedSlice.mve) : 0;
  const gain = selectedSlice ? parseFloat(selectedSlice.absoluteGain) : 0;

  // Best / Worst / Spread across all slices
  const summary = useMemo(() => {
    if (!slices || slices.length === 0) return null;
    const ranked = slices
      .map((s) => ({ slice: s, ttw: parseFloat(s.ttwror) }))
      .filter((r) => Number.isFinite(r.ttw)) // native-ok
      .sort((a, b) => b.ttw - a.ttw);
    if (ranked.length === 0) return null;
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    const spreadPp = (best.ttw - worst.ttw) * 100; // native-ok — display only, fractional → pp
    return { best, worst, spreadPp, count: ranked.length };
  }, [slices]);

  // Composition: top-level categories' market value share
  const compositionSegments = useMemo(() => {
    if (!tree || !slices) return [];
    const segs = tree.categories
      .map((cat) => {
        const slice = slicesById.get(cat.id);
        const mv = slice ? parseFloat(slice.mve) : 0;
        return {
          categoryName: translateTaxonomyName(cat.name),
          color: cat.color,
          mv: Number.isFinite(mv) ? Math.max(0, mv) : 0, // native-ok
        };
      })
      .filter((s) => s.mv > 0);
    const total = segs.reduce((acc, s) => acc + s.mv, 0); // native-ok
    if (total <= 0) return [];
    return segs.map((s) => ({
      categoryName: s.categoryName,
      color: s.color,
      mv: s.mv,
      weight: Math.round((s.mv / total) * 10000), // native-ok — basis points
    }));
  }, [tree, slices, slicesById]);

  // Top performers: top 5 by ttwror desc (across all categories)
  const topPerformers = useMemo(() => {
    if (!slices) return [];
    return slices
      .map((s) => ({ slice: s, ttw: parseFloat(s.ttwror) }))
      .filter((r) => Number.isFinite(r.ttw)) // native-ok
      .sort((a, b) => b.ttw - a.ttw)
      .slice(0, 5);
  }, [slices]);

  function handleTaxonomyChange(id: string) {
    setSelectedTaxonomyId(id);
    setSelectedCategoryId(null);
    saveSettings({ defaultDataSeriesTaxonomyId: id });
  }

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
  const [seriesVersion, setSeriesVersion] = useState(0);

  const chartData = useMemo(() => {
    if (!selectedSlice) return [];
    return [...selectedSlice.chartData]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({
        time: p.date as string,
        value: parseFloat(chartMode === 'mv' ? p.marketValue : p.ttwrorCumulative),
      }));
  }, [selectedSlice, chartMode]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || !chartData.length) return;

    try {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
    } catch { seriesRef.current = null; return; }

    const SERIES_MAP = { Line: LineSeries, Area: AreaSeries } as const;

    const { seriesType, options } = buildSeriesOptions(chartType, { color: sliceColor });
    const Constructor = SERIES_MAP[seriesType as keyof typeof SERIES_MAP] ?? AreaSeries;
    const series: ISeriesApi<SeriesType> = chart.addSeries(Constructor, options);

    if (chartMode === 'ttwror') {
      series.applyOptions({
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => `${(price * 100).toFixed(2)}%`, // native-ok
        },
      } as Record<string, unknown>);
    }

    series.setData(chartData);
    chart.timeScale().fitContent();
    seriesRef.current = series;
    setSeriesVersion((v) => v + 1); // native-ok
  }, [chartType, chartMode, sliceColor, chartData, ready]);

  const formatLegendValue = (v: number) =>
    chartMode === 'mv'
      ? new Intl.NumberFormat(undefined, { style: 'currency', currency: baseCurrency }).format(v)
      : formatPercentage(v);

  const legendItems: LegendSeriesItem[] = seriesVersion > 0 && seriesRef.current && selectedSlice
    ? [
        {
          id: 'taxonomy-series',
          label: translateTaxonomyName(selectedSlice.categoryName),
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (taxonomiesLoading) {
    return (
      <div className="qv-page qv-no-card-lift space-y-6">
        <PageHeader title={tNav('items.dataSeries')} subtitle={t('taxonomySeries.subtitle')} />
        <Skeleton className="h-8 w-full rounded-md" />
      </div>
    );
  }
  if (!taxonomies || taxonomies.length === 0) {
    return (
      <div className="qv-page qv-no-card-lift space-y-6">
        <PageHeader title={tNav('items.dataSeries')} subtitle={t('taxonomySeries.subtitle')} />
        <EmptyState icon={BarChart3} title={t('taxonomySeries.noTaxonomies')} />
      </div>
    );
  }

  return (
    <div className="qv-page qv-no-card-lift space-y-6">
      <PageHeader title={tNav('items.dataSeries')} subtitle={t('taxonomySeries.subtitle')} />

      {/* BEST / WORST / SPREAD summary strip */}
      {summary && (
        <SummaryStrip
          columns={3}
          items={[
            {
              label: t('taxonomySeries.best'),
              value: (
                <div className="flex flex-col gap-1">
                  <SignedPercent value={summary.best.ttw} className="text-xl" />
                  <span className="text-xs text-muted-foreground truncate">
                    {translateTaxonomyName(summary.best.slice.categoryName)}
                  </span>
                </div>
              ),
            },
            {
              label: t('taxonomySeries.worst'),
              value: (
                <div className="flex flex-col gap-1">
                  <SignedPercent value={summary.worst.ttw} className="text-xl" />
                  <span className="text-xs text-muted-foreground truncate">
                    {translateTaxonomyName(summary.worst.slice.categoryName)}
                  </span>
                </div>
              ),
            },
            {
              label: t('taxonomySeries.spread'),
              value: (
                <div className="flex flex-col gap-1">
                  <span className="qv-numeric text-xl font-medium text-[var(--qv-text-display)]">
                    {summary.spreadPp.toFixed(1)} pp
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {t('taxonomySeries.spreadAcross', { count: summary.count })}
                  </span>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Adaptive layout — stacked below xl (1280px), 3-col at xl+.
          Source order: center / left rail / right rail. On xl, `order`
          utilities reposition center to middle, left rail to left,
          right rail to right. Below xl, the natural flex stack keeps
          the center hero first (chart + metrics), then the category
          rail, then the comparative rails (composition + top
          performers) side-by-side at md+. */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_300px] gap-5 items-start">
        {/* LEFT RAIL — taxonomy + category tree with sparklines */}
        <Card className="rounded-md order-2 xl:order-1">
          <CardContent className="p-4 space-y-3">
            <div>
              <span className="qv-eyebrow block mb-1.5">{t('taxonomySeries.selectTaxonomy')}</span>
              <Select
                value={selectedTaxonomyId ?? ''}
                onValueChange={handleTaxonomyChange}
                disabled={savePending}
              >
                <SelectTrigger className="h-8 w-full text-sm">
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
            <div className="h-px bg-[var(--qv-border-subtle)]" />
            <div>
              <span className="qv-eyebrow block mb-1.5">{t('taxonomySeries.categoriesLabel')}</span>
              <div className="flex flex-col">
                {(treeLoading || slicesLoading) && (
                  <div className="space-y-1.5 py-1">
                    <Skeleton className="h-7 w-full rounded" />
                    <Skeleton className="h-7 w-5/6 rounded" />
                    <Skeleton className="h-7 w-4/6 rounded" />
                    <Skeleton className="h-7 w-full rounded" />
                  </div>
                )}
                {!treeLoading && !slicesLoading && flatNodes.map((node) => {
                  const isSelected = selectedCategoryId === node.id;
                  const color = node.color ?? palette[0];
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(node.id)}
                      className={cn(
                        'flex items-center gap-2 pr-2 py-1 rounded-sm text-left transition-colors min-w-0 border-l-2',
                        'hover:bg-[var(--qv-surface-elevated)]',
                        isSelected
                          ? 'bg-[var(--qv-surface-elevated)]'
                          : 'border-l-transparent',
                      )}
                      style={{
                        paddingLeft: `${6 + node.depth * 12}px`,
                        borderLeftColor: isSelected ? color : undefined,
                      }}
                    >
                      {node.depth === 0 && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                      )}
                      <span className={cn(
                        'truncate text-sm',
                        isSelected && 'font-medium text-[var(--qv-text-display)]',
                        !isSelected && node.depth === 0 && 'text-foreground',
                        !isSelected && node.depth > 0 && 'text-muted-foreground',
                      )}>
                        {translateTaxonomyName(node.name)}
                      </span>
                    </button>
                  );
                })}
                {!treeLoading && !slicesLoading && flatNodes.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-2">
                    {t('taxonomySeries.noCategoryData')}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CENTER — hero + chart + metrics */}
        <FadeIn className="order-1 xl:order-2">
          <Card className="rounded-md" style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '120ms' }}>
            <CardContent className="p-5">
              {/* Header: eyebrow + hero + toolbars */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <span className="qv-eyebrow block mb-1 truncate">
                    {selectedSlice ? translateTaxonomyName(selectedSlice.categoryName) : '—'}
                  </span>
                  {slicesLoading ? (
                    <Skeleton className="h-10 w-40 rounded" />
                  ) : (
                    <SignedPercent
                      value={selectedSlice ? ttwror : null}
                      className="text-4xl md:text-5xl tracking-tight"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ChartToolbar
                    chartId={CHART_ID}
                    activeType={chartType}
                    hasOhlc={false}
                    onTypeChange={handleTypeChange}
                  />
                  <SegmentedControl
                    segments={[
                      { value: 'ttwror', label: t('taxonomySeries.ttwrorPercent') },
                      { value: 'mv', label: t('taxonomySeries.marketValue') },
                    ]}
                    value={chartMode}
                    onChange={setChartMode}
                  />
                </div>
              </div>

              {/* Chart */}
              {slicesLoading ? (
                <div className="h-[320px]">
                  <Skeleton className="w-full h-full rounded-md" />
                </div>
              ) : selectedSlice ? (
                <>
                  <div className="mb-1">
                    <ChartLegendOverlay
                      chart={chartRef.current}
                      items={legendItems}
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
                </>
              ) : (
                <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
                  {t('taxonomySeries.selectCategory')}
                </div>
              )}

              {/* Metric tiles */}
              {selectedSlice && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-[var(--qv-border-subtle)]">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="qv-eyebrow truncate">{t('taxonomySeries.ttwrorPa')}</span>
                    <SignedPercent value={ttwrorPa} className="text-sm" />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="qv-eyebrow truncate">{t('taxonomySeries.irr')}</span>
                    <SignedPercent value={irr} className="text-sm" />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="qv-eyebrow truncate">{t('taxonomySeries.mve')}</span>
                    <CurrencyDisplay value={mve} className="qv-numeric text-sm font-medium" />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="qv-eyebrow truncate">{t('taxonomySeries.gain')}</span>
                    <CurrencyDisplay value={gain} colorize className="qv-numeric text-sm font-medium" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </FadeIn>

        {/* RIGHT RAIL — composition + top performers. Side-by-side at
            md when stacked (uses page width before xl 3-col kicks in),
            stacked vertically again inside the 300px rail at xl. */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-5 order-3 xl:order-3">
          {compositionSegments.length > 0 && (
            <Card className="rounded-md">
              <CardContent className="p-4">
                <span className="qv-eyebrow block mb-3">{t('taxonomySeries.composition')}</span>
                <CompositionSplitBar segments={compositionSegments} />
                <div className="flex flex-col gap-1 mt-3">
                  {compositionSegments.map((seg) => (
                    <div
                      key={seg.categoryName}
                      className="flex items-center justify-between gap-2 py-0.5"
                    >
                      <span className="flex items-center gap-2 text-[13px] text-foreground min-w-0">
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: seg.color ?? palette[0] }}
                        />
                        <span className="truncate">{seg.categoryName}</span>
                      </span>
                      <span className="qv-numeric text-xs text-muted-foreground">
                        {formatPercentage(seg.weight / 10000, 1)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {topPerformers.length > 0 && (
            <Card className="rounded-md">
              <CardContent className="p-4">
                <span className="qv-eyebrow block mb-3">{t('taxonomySeries.topPerformers')}</span>
                <div className="flex flex-col">
                  {topPerformers.map((row, idx) => (
                    <div
                      key={row.slice.categoryId}
                      className="grid grid-cols-[24px_1fr_auto] gap-2 items-center py-1.5 border-b border-[var(--qv-border-subtle)] last:border-b-0"
                    >
                      <span
                        className="font-display italic text-muted-foreground text-sm"
                        style={{ fontVariationSettings: '"opsz" 14' }}
                      >
                        {toRoman(idx + 1)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedCategoryId(row.slice.categoryId)}
                        className="text-[13px] text-left text-foreground hover:underline truncate"
                      >
                        {translateTaxonomyName(row.slice.categoryName)}
                      </button>
                      <SignedPercent value={row.ttw} className="text-xs" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Local composition split bar ─────────────────────────────────────────────
// Lightweight inline bar (the shared SplitBar primitive has a fixed pixel
// width designed for inline use next to a number; here we need full-rail
// width plus distinct legend rendering).

interface CompositionSegment {
  categoryName: string;
  color: string | null;
  weight: number; // basis points
}

function CompositionSplitBar({ segments }: { segments: CompositionSegment[] }) {
  return (
    <div className="flex h-2 rounded-sm overflow-hidden bg-[var(--qv-surface-elevated)]">
      {segments.map((seg) => (
        <span
          key={seg.categoryName}
          className="h-full"
          style={{
            width: `${(seg.weight / 100).toFixed(2)}%`,
            backgroundColor: seg.color ?? 'var(--muted-foreground)',
          }}
        />
      ))}
    </div>
  );
}

// Tiny lowercase-roman numeral helper (1..10 cover the realistic top-N list).
const ROMAN_ATOMS: Array<[number, string]> = [
  [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function toRoman(n: number): string {
  let remaining = n; // native-ok
  let out = '';
  for (const [v, sym] of ROMAN_ATOMS) {
    while (remaining >= v) { // native-ok
      out += sym;
      remaining -= v; // native-ok
    }
  }
  return out;
}
