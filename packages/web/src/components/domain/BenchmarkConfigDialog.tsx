import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { useChartConfig, useSaveChartConfig } from '@/api/use-chart-config';
import { useSecurities } from '@/api/use-securities';
import { useChartColors } from '@/hooks/use-chart-colors';
import type { BenchmarkConfig } from '@quovibe/shared';

const MAX_BENCHMARKS = 5;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BenchmarkConfigDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('performance');
  const { data: chartConfig } = useChartConfig();
  const { data: securities = [] } = useSecurities();
  const saveMutation = useSaveChartConfig();
  const { palette, profit, dividend } = useChartColors();

  const [search, setSearch] = useState('');

  const currentBenchmarks: BenchmarkConfig[] = chartConfig?.benchmarks ?? [];

  // Filter out colors used by MV (profit) and TTWROR (dividend)
  const benchmarkPalette = useMemo(() => {
    const used = new Set([profit, dividend]);
    return palette.filter((c) => !used.has(c));
  }, [palette, profit, dividend]);

  const selectedIds = useMemo(
    () => new Set(currentBenchmarks.map((b) => b.securityId)),
    [currentBenchmarks],
  );

  const filteredSecurities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return securities
      .filter((s) => !selectedIds.has(s.id))
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.ticker ?? '').toLowerCase().includes(q) ||
          (s.isin ?? '').toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [securities, selectedIds, search]);

  function getColor(index: number): string {
    return benchmarkPalette[index % benchmarkPalette.length] ?? '#8b5cf6';
  }

  function handleAdd(securityId: string) {
    if (currentBenchmarks.length >= MAX_BENCHMARKS) return;
    const color = getColor(currentBenchmarks.length);
    const next: BenchmarkConfig[] = [
      ...currentBenchmarks,
      { securityId, color },
    ];
    saveMutation.mutate({ benchmarks: next });
    setSearch('');
  }

  function handleRemove(securityId: string) {
    const next = currentBenchmarks
      .filter((b) => b.securityId !== securityId)
      .map((b, i) => ({ ...b, color: getColor(i) }));
    saveMutation.mutate({ benchmarks: next });
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) setSearch('');
    onOpenChange(nextOpen);
  }

  function getSecurityName(securityId: string): string {
    return securities.find((s) => s.id === securityId)?.name ?? securityId;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md h-[min(85vh,480px)] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {t('chart.benchmarks')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('chart.benchmarksDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 py-2">
          {/* Selected benchmarks */}
          {currentBenchmarks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('chart.noBenchmarks')}
            </p>
          ) : (
            <ul className="space-y-2">
              {currentBenchmarks.map((bm) => (
                <li
                  key={bm.securityId}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: bm.color ?? getColor(0) }}
                  />
                  <span className="flex-1 truncate text-sm">
                    {getSecurityName(bm.securityId)}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => handleRemove(bm.securityId)}
                    aria-label={t('chart.removeBenchmark')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add benchmark search */}
          {currentBenchmarks.length < MAX_BENCHMARKS && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t('chart.addBenchmarkCount', {
                  count: currentBenchmarks.length,
                  max: MAX_BENCHMARKS,
                })}
              </p>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('chart.searchSecurity')}
              />
              {filteredSecurities.length > 0 && (
                <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                  {filteredSecurities.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                        onClick={() => handleAdd(s.id)}
                      >
                        <span className="font-medium">{s.name}</span>
                        {s.ticker && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {s.ticker}
                          </span>
                        )}
                        {s.isin && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {s.isin}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {search.trim().length > 0 && filteredSecurities.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('chart.noMatchingSecurities')}
                </p>
              )}
            </div>
          )}

          {currentBenchmarks.length >= MAX_BENCHMARKS && (
            <p className="text-xs text-muted-foreground">
              {t('chart.maxBenchmarksReached', { max: MAX_BENCHMARKS })}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button onClick={() => handleClose(false)}>
            {t('common:close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
