import { Info } from 'lucide-react';
import { useCalculation, useReportingPeriod } from '@/api/use-performance';
import { useScopedApi } from '@/api/use-scoped-api';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { GainBadge } from '@/components/shared/GainBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { formatDate } from '@/lib/formatters';

interface ChartPoint {
  date: string;
  marketValue: string;
}

function useHeroSparkline(periodStart: string, periodEnd: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: ['portfolios', api.portfolioId, 'hero-sparkline', periodStart, periodEnd],
    queryFn: async () => {
      const data = await api.fetch<ChartPoint[]>(
        `/api/performance/chart?periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      return data.map((p) => parseFloat(p.marketValue));
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const h = 60;
  const w = 300;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h * 0.9 - h * 0.05;
    return { x, y };
  });

  const pathStr = points.map((p) => `${p.x},${p.y}`).join(' L');
  const linePath = `M${pathStr}`;
  const areaPath = `${linePath} L${w},${h} L0,${h}Z`;
  const color = positive ? 'var(--qv-positive)' : 'var(--qv-negative)';
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="hero-spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.08} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#hero-spark-grad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={first.x} cy={first.y} r="2" fill="var(--qv-text-faint)" />
      <circle cx={last.x} cy={last.y} r="2.5" fill={color} />
    </svg>
  );
}

export function DashboardHero() {
  const { t } = useTranslation('dashboard');
  const { periodStart, periodEnd } = useReportingPeriod();
  const { data: calc, isLoading } = useCalculation();
  const { data: sparkData } = useHeroSparkline(periodStart, periodEnd);
  const { isPrivate } = usePrivacy();

  if (isLoading || !calc) {
    return (
      <div className="flex items-start gap-6 md:gap-12">
        <div>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-14 w-56 mb-2" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1">
          <Skeleton className="h-[80px] w-full" />
        </div>
      </div>
    );
  }

  const balance = parseFloat(calc.finalValue);
  const absPerf = parseFloat(calc.absolutePerformance);
  const absPerfPct = parseFloat(calc.absolutePerformancePct);
  const isPositive = absPerf >= 0;

  return (
    <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-12 qv-fade-in">
      {/* Left: Balance + period context + Gain/Loss */}
      <div className="shrink-0">
        <div className="qv-eyebrow flex items-center gap-2">
          <span>{t('hero.portfolioValue')}</span>
          <span aria-hidden="true" className="text-[var(--qv-text-faint)]">·</span>
          <span className="text-[var(--qv-text-secondary)]">
            {t('hero.asOf', { date: formatDate(periodEnd) })}
          </span>
        </div>
        <div
          className="mt-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontVariationSettings: "'opsz' 144, 'wght' 500",
            fontFeatureSettings: '"tnum" 1, "lnum" 1, "zero" 1',
          }}
        >
          <CurrencyDisplay
            value={balance}
            className="text-5xl md:text-6xl leading-[1.05] tracking-[-0.02em]"
          />
        </div>
        <div className="mt-4 flex items-center gap-1">
          <span className="qv-eyebrow">
            {t('widgetTypes.absolute-performance')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground/40 hover:text-muted-foreground shrink-0"
                aria-label={t('widgetTypes.absolute-performance')}
              >
                <Info className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px]">
              <p className="text-xs">{t('catalog.desc.absolute-performance')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <CurrencyDisplay
            value={absPerf}
            colorize
            className="qv-numeric text-base font-medium"
          />
          {!isPrivate && <GainBadge value={absPerfPct} />}
        </div>
      </div>
      {/* Right: Sparkline — compact inline on mobile, full panel on desktop */}
      <div
        className={cn(
          'min-w-0 w-full md:flex-1 h-10 md:h-[80px] flex items-end pb-1',
          isPrivate && 'blur-sm saturate-0',
        )}
      >
        {sparkData && sparkData.length > 1 && (
          <Sparkline values={sparkData} positive={isPositive} />
        )}
      </div>
    </div>
  );
}
