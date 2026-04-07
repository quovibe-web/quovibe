import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Trash2, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useChartConfig, useSaveChartConfig } from '@/api/use-chart-config';
import { useSecurities } from '@/api/use-securities';
import { cn } from '@/lib/utils';
import type { DataSeriesConfig, ChartConfig, DataSeriesType, LineStyle } from '@quovibe/shared';
import { generateSeriesId } from '@quovibe/shared';

const MAX_SERIES = 10;

const LINE_STYLE_CYCLE: LineStyle[] = ['solid', 'dashed', 'dotted'];

/**
 * Hex color palette for series assignment. Must be valid #RRGGBB to pass
 * the dataSeriesConfigSchema color regex. These approximate the chart
 * palette hues from globals.css.
 */
const SERIES_HEX_PALETTE = [
  '#5b74a8', // chart-1 (steel blue)
  '#5ba89e', // chart-2 (teal)
  '#a8885b', // chart-3 (amber)
  '#a85b6e', // chart-4 (rose)
  '#7b5ba8', // chart-5 (violet)
  '#5ba870', // chart-6 (green)
  '#a8705b', // chart-7 (sienna)
  '#5b8ea8', // chart-8 (sky)
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DataSeriesPickerDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('performance');
  const { data: chartConfig } = useChartConfig();
  const { data: securities = [] } = useSecurities();
  const saveMutation = useSaveChartConfig();

  // Draft state — only saved on Apply
  const [draft, setDraft] = useState<DataSeriesConfig[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Initialize draft from config when dialog opens
  if (open && !initialized) {
    setDraft(chartConfig?.series ?? []);
    setInitialized(true);
  }
  if (!open && initialized) {
    setInitialized(false);
  }

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('portfolio');

  function nextColor(): string {
    return SERIES_HEX_PALETTE[draft.length % SERIES_HEX_PALETTE.length] ?? '#8b5cf6';
  }

  function addSeries(type: DataSeriesType, securityId?: string, label?: string) {
    if (draft.length >= MAX_SERIES) return;
    const newSeries: DataSeriesConfig = {
      id: generateSeriesId(),
      type,
      ...(securityId ? { securityId } : {}),
      color: nextColor(),
      visible: true,
      lineStyle: type === 'benchmark' ? 'dashed' : 'solid',
      ...(label ? { label } : {}),
    };
    setDraft((prev) => [...prev, newSeries]);
  }

  function removeSeries(id: string) {
    setDraft((prev) => prev.filter((s) => s.id !== id));
  }

  function toggleVisible(id: string) {
    setDraft((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)),
    );
  }

  function cycleLineStyle(id: string) {
    setDraft((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const idx = LINE_STYLE_CYCLE.indexOf(s.lineStyle);
        const next = LINE_STYLE_CYCLE[(idx + 1) % LINE_STYLE_CYCLE.length];
        return { ...s, lineStyle: next };
      }),
    );
  }

  function handleApply() {
    const config: ChartConfig = { version: 2, series: draft };
    saveMutation.mutate(config);
    onOpenChange(false);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  // Check if portfolio types are already added
  const hasPortfolio = draft.some((s) => s.type === 'portfolio');

  // Track which security IDs are already in draft by type
  const draftBenchmarkIds = useMemo(
    () => new Set(draft.filter((s) => s.type === 'benchmark').map((s) => s.securityId)),
    [draft],
  );
  const draftSecurityIds = useMemo(
    () => new Set(draft.filter((s) => s.type === 'security').map((s) => s.securityId)),
    [draft],
  );

  // Securities the user owns (has transactions)
  const ownedSecurities = useMemo(
    () => securities.filter((s) => !s.isRetired),
    [securities],
  );

  // Filtered securities for search
  const filteredSecurities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeTab === 'securities' ? ownedSecurities.slice(0, 20) : securities.slice(0, 20);
    const source = activeTab === 'securities' ? ownedSecurities : securities;
    return source
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.ticker ?? '').toLowerCase().includes(q) ||
          (s.isin ?? '').toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [securities, ownedSecurities, search, activeTab]);

  function getSeriesLabel(s: DataSeriesConfig): string {
    if (s.label) return s.label;
    switch (s.type) {
      case 'portfolio':
        return t('chart.entirePortfolio');
      case 'security':
      case 'benchmark': {
        const sec = securities.find((item) => item.id === s.securityId);
        const name = sec?.name ?? s.securityId ?? 'Unknown';
        return s.type === 'benchmark' ? `${name} ${t('chart.benchmarkSuffix')}` : name;
      }
      case 'account':
        return s.accountId ?? 'Account';
    }
  }

  function getTypeBadge(type: DataSeriesType): string {
    switch (type) {
      case 'portfolio':
        return t('chart.seriesTypeBadge_portfolio');
      case 'security':
        return t('chart.seriesTypeBadge_security');
      case 'account':
        return t('chart.seriesTypeBadge_account');
      case 'benchmark':
        return t('chart.seriesTypeBadge_benchmark');
    }
  }

  function getLineStyleIcon(style: LineStyle) {
    switch (style) {
      case 'solid':
        return <Minus className="h-3 w-3" />;
      case 'dashed':
        return <span className="inline-block w-3 h-0 border-t-2 border-dashed border-current" />;
      case 'dotted':
        return <span className="inline-block w-3 h-0 border-t-2 border-dotted border-current" />;
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-lg h-[min(85vh,600px)] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('chart.configureSeries')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('chart.configureSeriesDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 py-2">
          {/* Active series list */}
          <div>
            <h4 className="text-sm font-medium mb-2">{t('chart.activeSeries')}</h4>
            {draft.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('chart.noSeries')}</p>
            ) : (
              <ul className="space-y-1.5">
                {draft.map((s) => (
                  <li
                    key={s.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md border border-border px-3 py-2',
                      !s.visible && 'opacity-50',
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color ?? SERIES_HEX_PALETTE[0] }}
                    />
                    <span className="flex-1 truncate text-sm">{getSeriesLabel(s)}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {getTypeBadge(s.type)}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => cycleLineStyle(s.id)}
                      title={t(`chart.lineStyle${s.lineStyle.charAt(0).toUpperCase() + s.lineStyle.slice(1)}` as 'chart.lineStyleSolid')}
                    >
                      {getLineStyleIcon(s.lineStyle)}
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => toggleVisible(s.id)}
                      aria-label={t('chart.toggleVisibility')}
                    >
                      {s.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeSeries(s.id)}
                      aria-label={t('chart.removeSeries')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add series section */}
          {draft.length < MAX_SERIES ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">{t('chart.addSeries')}</h4>
                <span className="text-xs text-muted-foreground">
                  {t('chart.addSeriesCount', { count: draft.length, max: MAX_SERIES })}
                </span>
              </div>
              <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSearch(''); }}>
                <TabsList className="w-full">
                  <TabsTrigger value="portfolio" className="flex-1">{t('chart.tabPortfolio')}</TabsTrigger>
                  <TabsTrigger value="securities" className="flex-1">{t('chart.tabSecurities')}</TabsTrigger>
                  <TabsTrigger value="benchmarks" className="flex-1">{t('chart.tabBenchmarks')}</TabsTrigger>
                </TabsList>

                <TabsContent value="portfolio" className="mt-2 space-y-2">
                  <button
                    type="button"
                    className={cn(
                      'w-full rounded-md border border-border px-3 py-2 text-left text-sm',
                      hasPortfolio
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                    disabled={hasPortfolio}
                    onClick={() => addSeries('portfolio')}
                  >
                    {t('chart.entirePortfolio')}
                    {hasPortfolio && <span className="ml-2 text-xs text-muted-foreground">({t('chart.activeSeries').toLowerCase()})</span>}
                  </button>
                </TabsContent>

                <TabsContent value="securities" className="mt-2 space-y-2">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('chart.searchSecurity')}
                  />
                  <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
                    {filteredSecurities.map((s) => {
                      const alreadySeries = draftSecurityIds.has(s.id);
                      const alreadyBenchmark = draftBenchmarkIds.has(s.id);
                      return (
                        <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm border-b border-border last:border-0">
                          <div className="flex-1 truncate">
                            <span className="font-medium">{s.name}</span>
                            {s.ticker && <span className="ml-2 text-xs text-muted-foreground">{s.ticker}</span>}
                          </div>
                          <div className="flex gap-1 shrink-0 ml-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => addSeries('security', s.id)}
                              disabled={draft.length >= MAX_SERIES || alreadySeries}
                            >
                              {alreadySeries ? t('chart.alreadyAdded') : t('chart.addAsSeries')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => addSeries('benchmark', s.id, `${s.name} ${t('chart.benchmarkSuffix')}`)}
                              disabled={draft.length >= MAX_SERIES || alreadyBenchmark}
                            >
                              {alreadyBenchmark ? t('chart.alreadyAdded') : t('chart.addAsBenchmark')}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </TabsContent>

                <TabsContent value="benchmarks" className="mt-2 space-y-2">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('chart.searchSecurity')}
                  />
                  <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
                    {filteredSecurities.map((s) => {
                      const alreadyBenchmark = draftBenchmarkIds.has(s.id);
                      return (
                        <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm border-b border-border last:border-0">
                          <div className="flex-1 truncate">
                            <span className="font-medium">{s.name}</span>
                            {s.ticker && <span className="ml-2 text-xs text-muted-foreground">{s.ticker}</span>}
                            {s.isin && <span className="ml-2 text-xs text-muted-foreground">{s.isin}</span>}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs px-2 shrink-0 ml-2"
                            onClick={() => addSeries('benchmark', s.id, `${s.name} ${t('chart.benchmarkSuffix')}`)}
                            disabled={draft.length >= MAX_SERIES || alreadyBenchmark}
                          >
                            {alreadyBenchmark ? t('chart.alreadyAdded') : t('chart.addAsBenchmark')}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('chart.maxSeriesReached', { max: MAX_SERIES })}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 shrink-0">
          <Button variant="outline" onClick={handleCancel}>
            {t('chart.cancel')}
          </Button>
          <Button onClick={handleApply}>
            {t('chart.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
