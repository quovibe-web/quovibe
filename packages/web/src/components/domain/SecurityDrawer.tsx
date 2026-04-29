import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import type { EditorSection } from '@/components/domain/SecurityEditor';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useFetchPrices } from '@/api/use-securities';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { useSecurityDrawerData } from '@/hooks/useSecurityDrawerData';
import { usePrivacy } from '@/context/privacy-context';
import { usePortfolio } from '@/context/PortfolioContext';
import { formatPercentage, formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { SecurityPerfResponse, StatementSecurityEntry } from '@/api/types';

interface SecurityDrawerProps {
  securityId: string | null;
  onClose: () => void;
  onEdit: (id: string, section?: EditorSection) => void;
  perfMap: Map<string, SecurityPerfResponse>;
  statementMap: Map<string, StatementSecurityEntry>;
  logoMap: Map<string, string>;
  periodSearch: string;
}

export function SecurityDrawer({
  securityId,
  onClose,
  onEdit,
  perfMap,
  statementMap,
  logoMap,
  periodSearch,
}: SecurityDrawerProps) {
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const { t } = useTranslation('investments');
  const { isPrivate } = usePrivacy();

  const { detail, perf, statement, isLoading } = useSecurityDrawerData({
    securityId,
    perfMap,
    statementMap,
  });

  const fetchPrices = useFetchPrices(securityId ?? '');

  const logoUrl = securityId ? logoMap.get(securityId) : undefined;

  // Compute unrealized gain percentage
  const unrealizedGainPct = useMemo(() => {
    if (!perf) return null;
    const purchaseVal = parseFloat(perf.purchaseValue);
    if (purchaseVal === 0) return null;
    return parseFloat(perf.unrealizedGain) / purchaseVal;
  }, [perf]);

  return (
    <Sheet open={!!securityId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        {isLoading || !detail ? (
          <div className="space-y-4 animate-pulse p-6">
            <SheetTitle className="sr-only">{t('drawer.loading')}</SheetTitle>
            <SheetDescription className="sr-only">{t('drawer.loading')}</SheetDescription>
            <div className="h-8 bg-muted rounded-md w-2/3" />
            <div className="h-24 bg-muted rounded-md" />
            <div className="h-32 bg-muted rounded-md" />
          </div>
        ) : (
          <>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-4">
              {/* Header */}
              <SheetHeader className="pb-2">
                <div className="flex items-center gap-3">
                  {logoUrl && (
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-lg truncate">{detail.name}</SheetTitle>
                    <SheetDescription className="sr-only">
                      {detail.name} {t('drawer.viewDetail').toLowerCase()}
                    </SheetDescription>
                    <div className="flex items-center gap-2 mt-1">
                      {detail.ticker && <Badge variant="secondary" className="text-xs">{detail.ticker}</Badge>}
                      <Badge variant="outline" className="text-xs">{detail.currency}</Badge>
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <Separator className="my-3" />

              {/* Hero metrics */}
              <div className="grid grid-cols-2 gap-3 py-3">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t('columns.marketValue')}</span>
                  {statement ? (
                    <>
                      <CurrencyDisplay
                        value={parseFloat(statement.marketValue)}
                        className="text-xl font-semibold tabular-nums block"
                      />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {isPrivate ? '••••' : `${statement.shares} × ${statement.pricePerShare}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-xl font-semibold text-muted-foreground">—</span>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t('columns.unrealizedGain')}</span>
                  {perf ? (
                    <>
                      <CurrencyDisplay
                        value={parseFloat(perf.unrealizedGain)}
                        colorize
                        className="text-xl font-semibold tabular-nums block"
                      />
                      {unrealizedGainPct !== null && (
                        <span className={cn(
                          'text-xs tabular-nums',
                          parseFloat(perf.unrealizedGain) >= 0 ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]'
                        )}>
                          {isPrivate ? '••••' : formatPercentage(unrealizedGainPct)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xl font-semibold text-muted-foreground">—</span>
                  )}
                </div>
              </div>

              <Separator className="my-3" />

              {/* Performance grid */}
              {perf && (
                <div className="py-3">
                  <h4 className="text-sm font-semibold text-muted-foreground mb-3">{t('drawer.performance')}</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCell label={t('columns.ttwror')} value={formatPercentage(parseFloat(perf.ttwror))} />
                    <MetricCell label={t('columns.ttwrorPa')} value={formatPercentage(parseFloat(perf.ttwrorPa))} />
                    <MetricCell label={t('columns.irr')} value={perf.irr !== null ? formatPercentage(parseFloat(perf.irr)) : '—'} />
                    <MetricCell label={t('columns.purchaseValue')}>
                      <CurrencyDisplay value={parseFloat(perf.purchaseValue)} className="text-sm font-medium tabular-nums" />
                    </MetricCell>
                    <MetricCell label={t('columns.realizedGain')}>
                      <CurrencyDisplay value={parseFloat(perf.realizedGain)} colorize className="text-sm font-medium tabular-nums" />
                    </MetricCell>
                    <MetricCell label={t('columns.dividends')}>
                      <CurrencyDisplay value={parseFloat(perf.dividends)} className="text-sm font-medium tabular-nums" />
                    </MetricCell>
                  </div>
                </div>
              )}

              <Separator className="my-3" />

              {/* Identity section */}
              <div className="py-3">
                <h4 className="text-sm font-semibold text-muted-foreground mb-3">{t('drawer.identity')}</h4>
                <div className="space-y-2 text-sm">
                  {detail.isin ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('columns.isin')}</span>
                      <span className="font-mono tabular-nums">{detail.isin}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('columns.isin')}</span>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => {
                          onClose();
                          if (securityId) onEdit(securityId, 'masterData');
                        }}
                      >
                        {t('drawer.addIsin')}
                      </button>
                    </div>
                  )}
                  {detail.ticker && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('columns.ticker')}</span>
                      <span>{detail.ticker}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('columns.currency')}</span>
                    <span>{detail.currency}</span>
                  </div>
                  {detail.latestPrice && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">{t('columns.latestQuote')}</span>
                      <span className="tabular-nums flex items-center gap-1">
                        {isPrivate ? '••••' : detail.latestPrice}
                        {detail.latestDate && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            {formatDate(detail.latestDate)}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={t('drawer.refreshPrices')}
                          disabled={fetchPrices.isPending || !securityId}
                          onClick={() => fetchPrices.mutate('merge')}
                          className="ml-1 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                        >
                          <RefreshCw className={cn('h-3 w-3', fetchPrices.isPending && 'animate-spin')} />
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sticky action buttons at bottom */}
            <div className="border-t px-6 py-3 flex gap-2">
              <Button
                onClick={() => {
                  onClose();
                  navigate(`/p/${portfolio.id}/investments/${securityId}${periodSearch}`);
                }}
                className="flex-1 gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                {t('drawer.viewDetail')}
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => {
                  onClose();
                  if (securityId) onEdit(securityId);
                }}
              >
                <Pencil className="h-4 w-4" />
                {t('drawer.editSecurity')}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Small helper for the performance grid cells */
function MetricCell({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <span className="text-[11px] text-muted-foreground leading-tight block">{label}</span>
      {children ?? <span className="text-sm font-medium tabular-nums">{value}</span>}
    </div>
  );
}
