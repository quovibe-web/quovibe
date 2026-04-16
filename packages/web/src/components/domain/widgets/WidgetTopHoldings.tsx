import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useHoldings } from '@/api/use-reports';
import { usePerformanceSecurities } from '@/api/use-performance';
import { useSecurities } from '@/api/use-securities';
import { usePortfolio } from '@/context/PortfolioContext';
import { usePrivacy } from '@/context/privacy-context';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useReportingPeriod } from '@/api/use-performance';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SecurityAvatar } from '@/components/shared/SecurityAvatar';
import { FadeIn } from '@/components/shared/FadeIn';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { HoldingsItem } from '@/api/types';

const TOP_N = 5;

function HoldingRow({
  rank,
  item,
  logoUrl,
  ttwror,
  isPrivate,
  onClick,
}: {
  rank: number;
  item: HoldingsItem;
  logoUrl: string | null | undefined;
  ttwror: string | undefined;
  isPrivate: boolean;
  onClick: () => void;
}) {
  const weight = parseFloat(item.percentage);
  const mv = parseFloat(item.marketValue);
  const ttwrorVal = ttwror !== undefined ? parseFloat(ttwror) : null;

  const ttwrorColor =
    ttwrorVal === null
      ? 'inherit'
      : ttwrorVal >= 0
        ? 'var(--qv-positive)'
        : 'var(--qv-negative)';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 h-[42px] w-full text-left',
        'rounded-md px-1 -mx-1 transition-colors duration-100',
        'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
    >
      {/* Rank */}
      <span className="w-4 shrink-0 text-[11px] font-semibold text-muted-foreground tabular-nums text-center">
        {rank}
      </span>

      {/* Logo */}
      <SecurityAvatar name={item.name} logoUrl={logoUrl} size="sm" />

      {/* Name + weight bar */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate leading-tight" title={item.name}>
          {item.name}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* Weight pill bar */}
          <div className="h-1 rounded-full bg-muted overflow-hidden w-12">
            <div
              className="h-full rounded-full bg-primary/50 transition-[width] duration-300"
              style={{ width: `${Math.min(100, weight)}%` }}
            />
          </div>
          <span
            className="text-[10px] tabular-nums text-muted-foreground"
            style={{ filter: isPrivate ? 'blur(6px) saturate(0)' : 'none', transition: 'filter 0.2s' }}
          >
            {isPrivate ? '••%' : `${weight.toFixed(1)}%`}
          </span>
        </div>
      </div>

      {/* Market value */}
      <div className="w-[88px] shrink-0 text-right text-sm tabular-nums overflow-hidden">
        <CurrencyDisplay value={mv} animated={false} />
      </div>

      {/* TTWROR */}
      <div
        className="w-[62px] shrink-0 text-right text-[11px] font-semibold tabular-nums overflow-hidden"
        style={{
          color: isPrivate ? undefined : ttwrorColor,
          filter: isPrivate ? 'blur(6px) saturate(0)' : 'none',
          transition: 'filter 0.2s',
        }}
      >
        {ttwrorVal === null ? '—' : formatPercentage(ttwrorVal)}
      </div>
    </button>
  );
}

export default function WidgetTopHoldings() {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const { isPrivate } = usePrivacy();
  const { periodOverride } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const { periodLabel } = useWidgetKpiMeta(null);

  const periodEnd = periodOverride?.periodEnd ?? urlEnd;
  const periodStart = periodOverride?.periodStart ?? urlStart;

  const { data: holdingsData, isLoading: holdingsLoading, isError: holdingsError } = useHoldings(periodEnd);
  const { data: perfData, isLoading: perfLoading } = usePerformanceSecurities({ periodStart, periodEnd });
  const { data: securities = [] } = useSecurities();

  const isLoading = holdingsLoading || perfLoading;

  // Build logo lookup (already cached by React Query — no extra network call)
  const logoMap = new Map<string, string>();
  for (const s of securities) {
    if (s.logoUrl) logoMap.set(s.id, s.logoUrl);
  }

  // Build TTWROR lookup
  const perfMap = new Map<string, string>();
  if (perfData) {
    for (const p of perfData) {
      perfMap.set(p.securityId, p.ttwror);
    }
  }

  const allHoldings = holdingsData?.items ?? [];
  // Holdings are already sorted by market value descending by the API
  const topHoldings = allHoldings.slice(0, TOP_N);
  const remaining = allHoldings.length - TOP_N;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1.5 p-2">
        {Array.from({ length: TOP_N }, (_, i) => (
          <Skeleton key={i} className="h-[42px] w-full" />
        ))}
      </div>
    );
  }

  if (holdingsError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('widget.topHoldings.loadError')}</AlertDescription>
      </Alert>
    );
  }

  if (topHoldings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-muted-foreground">
        {t('widget.topHoldings.noHoldings')}
      </div>
    );
  }

  return (
    <FadeIn>
      <div className="flex flex-col px-1">
        {topHoldings.map((item, index) => (
          <HoldingRow
            key={item.securityId}
            rank={index + 1}
            item={item}
            logoUrl={logoMap.get(item.securityId)}
            ttwror={perfMap.get(item.securityId)}
            isPrivate={isPrivate}
            onClick={() => navigate(`/p/${portfolio.id}/investments/${item.securityId}`)}
          />
        ))}

        {remaining > 0 && (
          <button
            type="button"
            onClick={() => navigate(`/p/${portfolio.id}/investments`)}
            className="mt-1 text-[11px] text-primary hover:underline text-left pl-6"
          >
            {t('widget.topHoldings.showMore', { count: remaining })}
          </button>
        )}

        <span className="text-[10px] text-muted-foreground mt-2 text-center">{periodLabel}</span>
      </div>
    </FadeIn>
  );
}
