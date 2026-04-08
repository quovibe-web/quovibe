import NumberFlow from '@number-flow/react';
import { useCalculation, useReportingPeriod } from '@/api/use-performance';
import { apiFetch } from '@/api/fetch';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';

interface ChartPoint {
  date: string;
  marketValue: string;
}

function useHeroSparkline(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: ['hero-sparkline', periodStart, periodEnd],
    queryFn: async () => {
      const data = await apiFetch<ChartPoint[]>(
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
    return `${x},${y}`;
  });

  const linePath = `M${points.join(' L')}`;
  const areaPath = `${linePath} L${w},${h} L0,${h}Z`;
  const color = positive ? 'var(--qv-positive)' : 'var(--qv-negative)';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="hero-spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#hero-spark-grad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
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
      <div className="flex items-start gap-6">
        <div>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-10 w-48 mb-2" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1 hidden md:block">
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
    <div className="flex items-start gap-6 qv-fade-in">
      {/* Left: Balance + Gain/Loss */}
      <div className="shrink-0">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('hero.portfolioValue')}
        </div>
        <div className="mt-1">
          {isPrivate ? (
            <span className="text-4xl font-extrabold tracking-tight">••••••</span>
          ) : (
            <CurrencyDisplay value={balance} className="text-4xl font-extrabold tracking-tight" />
          )}
        </div>
        <div className="flex items-baseline gap-3 mt-1.5">
          {isPrivate ? (
            <span className="text-sm text-muted-foreground">••••••</span>
          ) : (
            <>
              <CurrencyDisplay
                value={absPerf}
                colorize
                className="text-sm font-medium"
              />
              <span
                className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  isPositive
                    ? 'bg-[var(--qv-positive)] text-[var(--qv-bg)]'
                    : 'bg-[var(--qv-negative)] text-[var(--qv-bg)]',
                )}
              >
                <NumberFlow
                  value={absPerfPct}
                  locales={i18n.language}
                  format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' }}
                />
              </span>
            </>
          )}
        </div>
      </div>
      {/* Right: Sparkline */}
      <div
        className={cn(
          'flex-1 min-w-0 h-[80px] hidden md:flex items-end pb-1',
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
