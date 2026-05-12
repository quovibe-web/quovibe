import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { useChartColors } from '@/hooks/use-chart-colors';
import {
  extractTopPayers,
  computeConcentration,
  aggregateByType,
  type AmountMode,
} from './IncomeRightRail.utils';
import type { PaymentGroup } from '@/api/types';
import type { DetailFilterType } from './IncomeDetailList.utils';

interface IncomeRightRailProps {
  combinedGroups: PaymentGroup[];
  amountMode: AmountMode;
  activeTypeFilter: DetailFilterType;
  onTypeFilterToggle: (type: 'DIVIDEND' | 'INTEREST') => void;
  securityIdByName: Map<string, string>;
}

const TOP_N_DEFAULT = 5;

export function IncomeRightRail({
  combinedGroups,
  amountMode,
  activeTypeFilter,
  onTypeFilterToggle,
  securityIdByName,
}: IncomeRightRailProps) {
  const { t } = useTranslation('reports');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { dividend, interest } = useChartColors();
  const [showAllPayers, setShowAllPayers] = useState(false);

  const { payers, cashInterest } = useMemo(
    () => extractTopPayers(combinedGroups, amountMode),
    [combinedGroups, amountMode],
  );
  const { top3Share, payerCount } = useMemo(
    () => computeConcentration(payers),
    [payers],
  );
  const byType = useMemo(
    () => aggregateByType(combinedGroups, amountMode),
    [combinedGroups, amountMode],
  );

  const topPayer = payers[0];
  const visiblePayers = showAllPayers ? payers : payers.slice(0, TOP_N_DEFAULT);
  const remainder = payers.slice(TOP_N_DEFAULT);
  const remainderTotal = remainder.reduce((s, p) => s + p.total, 0);
  const remainderShare = remainder.reduce((s, p) => s + p.share, 0);

  const showConcentration = top3Share > 0.5 && payerCount > 5;

  if (byType.total <= 0) return null;

  return (
    <Card className="rounded-md lg:sticky lg:top-4 self-start">
      <CardContent className="p-4 space-y-4">
        {payers.length > 0 && (
          <div>
            <div className="qv-eyebrow mb-3">{t('payments.rail.topPayers')}</div>
            <div className="space-y-2">
              {visiblePayers.map((p) => {
                const secId = securityIdByName.get(p.name);
                const widthPct = topPayer ? (p.total / topPayer.total) * 100 : 0;
                const nameNode = secId ? (
                  <Link
                    to={`/p/${portfolioId}/securities/${secId}`}
                    className="truncate text-xs hover:underline underline-offset-4"
                    title={p.name}
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="truncate text-xs" title={p.name}>{p.name}</span>
                );
                return (
                  <div key={p.name}>
                    <div className="grid grid-cols-[minmax(0,1fr)_72px_36px] gap-2 items-baseline">
                      {nameNode}
                      <span className="qv-numeric text-xs font-medium text-right">
                        <CurrencyDisplay value={p.total} animated={false} />
                      </span>
                      <span className="qv-numeric text-xs text-[var(--qv-text-faint)] text-right">
                        {Math.round(p.share * 100)}%
                      </span>
                    </div>
                    <div
                      className="h-1 mt-1 rounded-sm bg-[var(--color-chart-1)]/30"
                      style={{ width: `${widthPct.toFixed(2)}%` }}
                    />
                  </div>
                );
              })}
              {cashInterest && (
                <div className="grid grid-cols-[minmax(0,1fr)_72px_36px] gap-2 items-baseline pt-2 border-t border-[var(--qv-border-subtle)]">
                  <span className="text-xs text-[var(--qv-text-secondary)]">{t('payments.rail.cashInterest')}</span>
                  <span className="qv-numeric text-xs font-medium text-right">
                    <CurrencyDisplay value={cashInterest.total} animated={false} />
                  </span>
                  <span className="qv-numeric text-xs text-[var(--qv-text-faint)] text-right">
                    {Math.round(cashInterest.share * 100)}%
                  </span>
                </div>
              )}
              {!showAllPayers && remainder.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllPayers(true)}
                  className="text-xs text-[var(--color-primary)] hover:underline underline-offset-4 w-full text-left pt-1"
                >
                  {t('payments.rail.morePayers', { count: remainder.length })} ·{' '}
                  <span className="qv-numeric">
                    <CurrencyDisplay value={remainderTotal} animated={false} />
                  </span>{' '}
                  <span className="qv-numeric text-[var(--qv-text-faint)]">
                    {Math.round(remainderShare * 100)}%
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {showConcentration && (
          <div className="border-l-2 border-[var(--qv-warning)] pl-3 py-1">
            <div className="qv-eyebrow flex items-center gap-1 text-[var(--qv-warning)]">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('payments.concentration.title')}
            </div>
            <div className="text-sm text-[var(--qv-warning)] mt-1">
              {t('payments.concentration.top3', { share: Math.round(top3Share * 100) })}
            </div>
          </div>
        )}

        <div>
          <div className="qv-eyebrow mb-2">{t('payments.rail.byType')}</div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onTypeFilterToggle('DIVIDEND')}
              className={`w-full text-left rounded-sm px-2 py-1 ${activeTypeFilter === 'DIVIDEND' ? 'bg-[var(--color-primary-fg)]/15' : 'hover:bg-[var(--qv-surface-3)]'}`}
            >
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: dividend }} />
                <span className="text-xs">{t('payments.dividends')}</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="qv-numeric text-sm font-medium">
                  <CurrencyDisplay value={byType.dividend} animated={false} />
                </span>
                <span className="qv-numeric text-xs text-[var(--qv-text-faint)]">
                  {Math.round(byType.dividendShare * 100)}%
                </span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onTypeFilterToggle('INTEREST')}
              className={`w-full text-left rounded-sm px-2 py-1 ${activeTypeFilter === 'INTEREST' ? 'bg-[var(--color-primary-fg)]/15' : 'hover:bg-[var(--qv-surface-3)]'}`}
            >
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: interest }} />
                <span className="text-xs">{t('payments.interest')}</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="qv-numeric text-sm font-medium">
                  <CurrencyDisplay value={byType.interest} animated={false} />
                </span>
                <span className="qv-numeric text-xs text-[var(--qv-text-faint)]">
                  {Math.round(byType.interestShare * 100)}%
                </span>
              </div>
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
