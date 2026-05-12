import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Search } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useChartConfig, useSaveChartConfig } from '@/api/use-chart-config';
import { useSecurities } from '@/api/use-securities';
import { useChartColors } from '@/hooks/use-chart-colors';
import { colorToHex } from '@/lib/colors';
import {
  buildCounterDisplay,
  buildAddSeriesPayload,
  filterSecurities,
  isAddDisabled,
  type SheetFilter,
  type SecurityForFilter,
} from './chart-series-sheet.utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChartSeriesSheet({ open, onOpenChange }: Props) {
  const { t } = useTranslation('performance');
  const { data: chartConfig } = useChartConfig();
  const counter = buildCounterDisplay(chartConfig?.series.length ?? 0);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SheetFilter>('all');

  const { data: securities = [] } = useSecurities();
  const saveMutation = useSaveChartConfig();
  const { palette } = useChartColors();
  const hexPalette = useMemo(() => palette.map(colorToHex), [palette]);

  // Map SecurityListItem → SecurityForFilter.
  // `shares` (string, scaled by 1e8) is present when the security has any
  // position; parse > 0 to determine ownership. This matches what
  // DataSeriesPickerDialog does implicitly by listing all non-retired items.
  const securitiesForFilter: SecurityForFilter[] = useMemo(() => {
    return securities.map((s) => ({
      id: s.id,
      name: s.name,
      ticker: s.ticker ?? null,
      isin: s.isin ?? null,
      isRetired: s.isRetired ?? false,
      isOwned: parseFloat(s.shares ?? '0') > 0, // native-ok
    }));
  }, [securities]);

  const filtered = useMemo(
    () => filterSecurities(securitiesForFilter, search, filter).slice(0, 50), // native-ok
    [securitiesForFilter, search, filter],
  );

  function nextColor(currentCount: number): string {
    return hexPalette[currentCount % hexPalette.length] ?? '#4385BE'; // native-ok
  }

  function addSeries(securityId: string, kind: 'holding' | 'reference') {
    if (!chartConfig) return;
    if (isAddDisabled(chartConfig.series.length)) return;
    const payload = buildAddSeriesPayload(
      securityId,
      kind,
      nextColor(chartConfig.series.length),
    );
    saveMutation.mutate({
      ...chartConfig,
      series: [...chartConfig.series, payload],
    });
  }

  const disabled = isAddDisabled(counter.count);

  // Number of series that can be removed (all except portfolio-default)
  const removableCount = (chartConfig?.series ?? []).filter((s) => s.id !== 'portfolio-default').length; // native-ok

  function handleRemoveAll(confirmed: boolean) {
    if (!chartConfig || !confirmed) return;
    const remaining = chartConfig.series.filter((s) => s.id === 'portfolio-default');
    saveMutation.mutate({ ...chartConfig, series: remaining });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[520px] flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('chart.sheet.title')}</SheetTitle>
          <SheetDescription className="sr-only">
            {t('chart.sheet.description')}
          </SheetDescription>
        </SheetHeader>

        {/* Body — search + filter chips + result list */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search
                className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('chart.sheet.search')}
              />
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'owned', 'index', 'account'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors',
                    filter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {t(`chart.sheet.filter.${f}` as 'chart.sheet.filter.all')}
                </button>
              ))}
            </div>

            {/* Semantic info tooltip */}
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <Info className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    className="max-w-xs text-xs leading-relaxed"
                    side="bottom"
                  >
                    {t('chart.semantic.tooltip')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Result list */}
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t('chart.sheet.noResults')}
              </p>
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {filtered.map((s) => {
                  const owned = s.isOwned === true;
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 px-2 py-2 text-sm"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium" title={s.name}>
                          {s.name}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {s.ticker ?? ''}
                        </span>
                      </span>

                      {/* Ownership badge */}
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                          owned
                            ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {owned
                          ? t('chart.badge.youHold')
                          : t('chart.badge.index')}
                      </span>

                      {/* Actions */}
                      <div className="shrink-0 flex gap-1">
                        {owned && (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={disabled}
                            onClick={() => addSeries(s.id, 'holding')}
                          >
                            {t('chart.action.addHolding')}
                          </Button>
                        )}
                        <Button
                          variant={owned ? 'outline' : 'default'}
                          size="sm"
                          className="h-7 text-xs"
                          disabled={disabled}
                          onClick={() => addSeries(s.id, 'reference')}
                        >
                          {t('chart.action.addReference')}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <SheetFooter className="border-t border-border px-4 py-3 sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-[var(--qv-danger)] hover:bg-[var(--qv-danger)]/10 hover:text-[var(--qv-danger)]"
                disabled={removableCount <= 0}
              >
                {t('chart.sheet.removeAll')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('chart.sheet.removeAll')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('chart.sheet.removeAllConfirm', { count: removableCount })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('chart.sheet.removeAllCancel')}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-[var(--qv-danger)] text-white hover:bg-[var(--qv-danger)]/90"
                  onClick={() => handleRemoveAll(true)}
                >
                  {t('chart.sheet.removeAllConfirmAction')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {t('chart.sheet.counter', { count: counter.count, max: counter.max })}
            </span>
            <Button onClick={() => onOpenChange(false)} size="sm">
              {t('chart.sheet.done')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
