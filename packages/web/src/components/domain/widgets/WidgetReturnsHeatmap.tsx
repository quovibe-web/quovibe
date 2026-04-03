import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useReturnsHeatmap } from '@/api/use-performance';
import { formatPercentage } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { useWidgetConfig } from '@/context/widget-config-context';
import { resolveDataSeriesToParams } from '@/lib/data-series-utils';
import { cn } from '@/lib/utils';
import { FadeIn } from '@/components/shared/FadeIn';
import { getCssVarRgb } from '@/lib/colors';

// ─── Color palettes ──────────────────────────────────────────────────────────

interface ColorPalette { positive: [number, number, number]; negative: [number, number, number] }

const PALETTE_FALLBACK: ColorPalette = {
  positive: [34, 197, 94],   // green-500 fallback
  negative: [239, 68, 68],   // red-500 fallback
};

function heatmapColor(value: number, palette: ColorPalette): string {
  if (value >= 0) {
    const t = Math.min(value / 0.20, 1);
    const alpha = 0.12 + t * 0.68;
    const [r, g, b] = palette.positive;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  const t = Math.min(Math.abs(value) / 0.05, 1);
  const alpha = 0.12 + t * 0.68;
  const [r, g, b] = palette.negative;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function legendGradient(palette: ColorPalette): string {
  const [nr, ng, nb] = palette.negative;
  const [pr, pg, pb] = palette.positive;
  return `linear-gradient(to right, rgba(${nr},${ng},${nb},0.70), rgba(${nr},${ng},${nb},0) 35%, transparent 50%, rgba(${pr},${pg},${pb},0) 65%, rgba(${pr},${pg},${pb},0.70))`;
}

// ─── Widget Component ─────────────────────────────────────────────────────────

export default function WidgetReturnsHeatmap() {
  const { t } = useTranslation('reports');
  const { t: tDash } = useTranslation('dashboard');
  const { dataSeries, periodOverride } = useWidgetConfig();
  const periodStart = periodOverride?.periodStart;
  const periodEnd = periodOverride?.periodEnd;
  const dsParams = resolveDataSeriesToParams(dataSeries);
  const { data, isLoading, isError, error, isFetching } = useReturnsHeatmap(
    periodStart,
    periodEnd,
    dsParams.filter,
    dsParams.withReference,
    dsParams.taxonomyId,
    dsParams.categoryId,
  );
  const { isPrivate } = usePrivacy();

  const palette = useMemo<ColorPalette>(() => ({
    positive: getCssVarRgb('--qv-success') ?? PALETTE_FALLBACK.positive,
    negative: getCssVarRgb('--qv-danger') ?? PALETTE_FALLBACK.negative,
  }), []);

  const monthsShort = t('returnsHeatmap.months', { returnObjects: true }) as string[];
  const monthsFull = t('returnsHeatmap.monthsFull', { returnObjects: true }) as string[];

  // Build lookup: year -> month(1-12) -> value
  const monthMap = new Map<number, Map<number, number>>();
  const yearMap = new Map<number, number>();

  if (data) {
    for (const m of data.monthly) {
      if (!monthMap.has(m.year)) monthMap.set(m.year, new Map());
      monthMap.get(m.year)!.set(m.month, parseFloat(m.value));
    }
    for (const y of data.yearly) {
      yearMap.set(y.year, parseFloat(y.value));
    }
  }

  const years = Array.from(monthMap.keys()).sort((a, b) => a - b);

  if (isLoading) {
    return (
      <div className="space-y-1.5 pt-1">
        {Array.from({ length: 4 }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex gap-0.5">
            <Skeleton className="h-6 w-10 rounded" />
            {Array.from({ length: 13 }).map((_, colIdx) => (
              <Skeleton key={colIdx} className="h-6 w-12 rounded" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  if (years.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-muted-foreground">
        {tDash('noChartData')}
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <FadeIn>
        <div className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity duration-200')}>
          <TooltipProvider delayDuration={100}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-separate border-spacing-[2px]">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold text-muted-foreground">
                      {t('returnsHeatmap.year')}
                    </th>
                    {monthsShort.map((m) => (
                      <th
                        key={m}
                        className="px-1.5 py-1 text-center font-semibold text-muted-foreground min-w-[48px]"
                      >
                        {m}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-center font-semibold text-muted-foreground min-w-[56px]">
                      {t('returnsHeatmap.year')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => {
                    const months = monthMap.get(year)!;
                    const yearVal = yearMap.get(year);
                    return (
                      <tr key={year}>
                        <td className="px-2 py-1 font-semibold text-foreground">
                          {year}
                        </td>
                        {monthsShort.map((_, i) => {
                          const month = i + 1;
                          const val = months.get(month);
                          if (val === undefined) {
                            return <td key={month} className="rounded-[4px]" />;
                          }
                          return (
                            <td key={month} className="p-0 rounded-[4px] overflow-hidden">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="px-1.5 py-1 text-center tabular-nums text-foreground cursor-default transition-opacity hover:opacity-80"
                                    style={{ backgroundColor: heatmapColor(val, palette) }}
                                  >
                                    {isPrivate ? '••••' : formatPercentage(val)}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {monthsFull[i]} {year}: {isPrivate ? '••••' : formatPercentage(val)}
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        })}
                        <td className="p-0 rounded-[4px] overflow-hidden">
                          {yearVal !== undefined ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="px-2 py-1 text-center font-semibold tabular-nums text-foreground cursor-default transition-opacity hover:opacity-80"
                                  style={{ backgroundColor: heatmapColor(yearVal, palette) }}
                                >
                                  {isPrivate ? '••••' : formatPercentage(yearVal)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t('returnsHeatmap.yearTotal', { year })}{isPrivate ? ' ••••' : ` ${formatPercentage(yearVal)}`}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="mt-3 flex flex-col items-center gap-0.5">
              <div
                className="h-2.5 w-56 rounded-sm border border-border"
                style={{ background: legendGradient(palette) }}
              />
              <div className="flex w-56 justify-between text-[9px] text-muted-foreground">
                <span>-5%</span>
                <span>0%</span>
                <span>+20%</span>
              </div>
            </div>
          </TooltipProvider>
        </div>
      </FadeIn>
    </div>
  );
}
