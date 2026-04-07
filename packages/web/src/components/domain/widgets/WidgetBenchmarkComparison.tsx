import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWidgetCalculation } from '@/hooks/use-widget-calculation';
import { useWidgetChartCalculation } from '@/hooks/use-widget-chart-calculation';
import { useBenchmarkSeries } from '@/api/use-benchmark-series';
import { useSecurities } from '@/api/use-securities';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useReportingPeriod } from '@/api/use-performance';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { formatPercentage } from '@/lib/formatters';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Sparkline } from '@/components/shared/Sparkline';

/** Downsample an array to at most `maxPoints` evenly spaced entries. */
function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints; // native-ok
  const result: T[] = [];
  for (let i = 0; i < maxPoints; i++) { // native-ok
    result.push(arr[Math.floor(i * step)]); // native-ok
  }
  // Always include last point
  const last = arr[arr.length - 1]; // native-ok
  if (result[result.length - 1] !== last) result.push(last); // native-ok
  return result;
}

function SparklineContainer({ data, color }: { data: { date: string; diff: number }[]; color: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth); // native-ok
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width); // native-ok
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const numericData = data.map((d) => d.diff);

  return (
    <div ref={containerRef} className="relative" style={{ height: 28, marginTop: 4 }}>
      {width > 0 && (
        <>
          <Sparkline data={numericData} width={width} height={28} color={color} fillOpacity={0.1} />
          <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-muted-foreground/30" />
        </>
      )}
    </div>
  );
}

export default function WidgetBenchmarkComparison() {
  const { t } = useTranslation('dashboard');
  const { options, periodOverride } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const { isPrivate } = usePrivacy();
  const { profit, danger } = useChartColors();

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;

  const benchmarkSecurityId =
    typeof options.benchmarkSecurityId === 'string' && options.benchmarkSecurityId.length > 0
      ? options.benchmarkSecurityId
      : null;

  // Portfolio TTWROR
  const calcQuery = useWidgetCalculation();

  // Portfolio chart points (for sparkline)
  const chartQuery = useWidgetChartCalculation();

  // Benchmark series — use widget-level period override
  const benchmarkIds = benchmarkSecurityId ? [benchmarkSecurityId] : [];
  const benchmarkQuery = useBenchmarkSeries(benchmarkIds, { periodStart, periodEnd });

  // Security name lookup
  const securitiesQuery = useSecurities();

  const benchmarkName = useMemo(() => {
    if (!benchmarkSecurityId || !securitiesQuery.data) return null;
    const sec = securitiesQuery.data.find((s) => s.id === benchmarkSecurityId);
    return sec?.name ?? null;
  }, [benchmarkSecurityId, securitiesQuery.data]);

  // Derived scalar values
  const portfolioTtwror = useMemo(() => {
    if (!calcQuery.data) return null;
    return parseFloat(calcQuery.data.ttwror);
  }, [calcQuery.data]);

  const benchmarkTtwror = useMemo(() => {
    const series = benchmarkQuery.data?.benchmarks?.[0]?.series;
    if (!series || series.length === 0) return null;
    return series[series.length - 1].cumulative; // native-ok (already a number)
  }, [benchmarkQuery.data]);

  const alpha = useMemo(() => {
    if (portfolioTtwror === null || benchmarkTtwror === null) return null;
    return portfolioTtwror - benchmarkTtwror; // native-ok (display-only difference)
  }, [portfolioTtwror, benchmarkTtwror]);

  // Sparkline data: portfolio ttwrorCumulative minus benchmark cumulative, aligned by date
  const sparklineData = useMemo(() => {
    const chartPoints = chartQuery.data;
    const benchmarkSeries = benchmarkQuery.data?.benchmarks?.[0]?.series;
    if (!chartPoints || !benchmarkSeries || chartPoints.length === 0 || benchmarkSeries.length === 0) {
      return [];
    }

    // Build a date → benchmark cumulative map
    const bmkMap = new Map<string, number>();
    for (const pt of benchmarkSeries) {
      bmkMap.set(pt.date, pt.cumulative);
    }

    // Build difference series (carry-forward last known benchmark value)
    let lastBmk = 0;
    const raw: { date: string; diff: number }[] = chartPoints.map((p) => {
      const bmk = bmkMap.get(p.date);
      if (bmk !== undefined) lastBmk = bmk;
      const portf = parseFloat(p.ttwrorCumulative);
      return { date: p.date, diff: portf - lastBmk }; // native-ok (display-only)
    });

    return downsample(raw, 80);
  }, [chartQuery.data, benchmarkQuery.data]);

  // ── No benchmark configured ──
  if (!benchmarkSecurityId) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
        {t('widget.noBenchmarkSelected')}
      </div>
    );
  }

  // ── Loading ──
  const isLoading =
    calcQuery.isLoading || benchmarkQuery.isLoading || securitiesQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 flex-1 px-1 py-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-7 w-full mt-1" />
      </div>
    );
  }

  // ── Error ──
  const error = calcQuery.error ?? benchmarkQuery.error;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  const alphaColor =
    alpha === null
      ? undefined
      : alpha >= 0
        ? 'var(--qv-positive)'
        : 'var(--qv-negative)';

  const sparklineColor = alpha !== null && alpha >= 0 ? profit : danger;

  return (
    <div
      className="flex flex-col gap-1 flex-1"
      style={{
        filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
        transition: 'filter 0.2s ease',
      }}
    >
      {/* Benchmark label */}
      {benchmarkName && (
        <span className="text-xs text-muted-foreground truncate">
          {t('widget.benchmarkLabel', { name: benchmarkName })}
        </span>
      )}

      {/* Portfolio row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('widget.portfolioLabel')}</span>
        <span className="text-sm font-medium tabular-nums">
          {portfolioTtwror !== null
            ? (isPrivate ? '••••' : formatPercentage(portfolioTtwror))
            : '—'}
        </span>
      </div>

      {/* Benchmark row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('widget.benchmarkTtwrorLabel')}</span>
        <span className="text-sm font-medium tabular-nums">
          {benchmarkTtwror !== null
            ? (isPrivate ? '••••' : formatPercentage(benchmarkTtwror))
            : '—'}
        </span>
      </div>

      <Separator className="my-0.5" />

      {/* Alpha row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('widget.alphaLabel')}</span>
        <span
          className="text-sm font-semibold tabular-nums"
          style={{ color: alphaColor }}
        >
          {alpha !== null
            ? (isPrivate ? '••••' : formatPercentage(alpha))
            : '—'}
        </span>
      </div>

      {/* Mini sparkline */}
      {sparklineData.length > 1 && (
        <SparklineContainer data={sparklineData} color={sparklineColor} />
      )}
    </div>
  );
}
