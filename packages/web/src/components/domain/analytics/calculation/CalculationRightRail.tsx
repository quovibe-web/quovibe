import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SignedPercent } from '@/components/shared/SignedPercent';
import { formatDate } from '@/lib/formatters';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

interface CalculationRightRailProps {
  data: CalculationBreakdownResponse;
}

export function CalculationRightRail({ data }: CalculationRightRailProps) {
  return (
    <div className="space-y-3 lg:sticky lg:top-4 self-start">
      <RiskStyleCard data={data} />
      <OpenPositionCard data={data} />
      <LastDayCard data={data} />
    </div>
  );
}

function RiskStyleCard({ data }: { data: CalculationBreakdownResponse }) {
  const { t } = useTranslation('performance');
  const vol = data.volatility != null ? parseFloat(data.volatility) : null;
  const semi = data.semivariance != null ? parseFloat(data.semivariance) : null;
  const maxDd = parseFloat(data.maxDrawdown);
  const currDd = parseFloat(data.currentDrawdown);

  if (vol === null && semi === null && maxDd === 0 && currDd === 0) return null;

  return (
    <Card className="rounded-md">
      <CardContent className="p-4 space-y-3">
        <div className="qv-eyebrow text-[var(--qv-text-faint)]">{t('calculation.rightRail.riskStyle')}</div>

        {vol !== null && (
          <RailRow labelKey="calculation.rightRail.volatility" value={vol} format="percent" />
        )}
        {semi !== null && (
          <RailRow labelKey="calculation.rightRail.semivariance" value={semi} format="percent" />
        )}

        {maxDd !== 0 && (
          <div className="pt-2 border-t border-[var(--qv-border-subtle)]">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--qv-text-secondary)]">{t('calculation.heroStrip.maxDrawdown')}</span>
              <SignedPercent value={maxDd} className="text-sm" />
            </div>
            {data.maxDrawdownPeakDate && (
              <div className="mt-2 pl-2 space-y-0.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--qv-text-faint)]">{t('calculation.rightRail.peak')}</span>
                  <span className="qv-numeric">{formatDate(data.maxDrawdownPeakDate)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--qv-text-faint)]">{t('calculation.rightRail.trough')}</span>
                  <span className="qv-numeric">{data.maxDrawdownTroughDate ? formatDate(data.maxDrawdownTroughDate) : '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--qv-text-faint)]">{t('calculation.rightRail.duration')}</span>
                  <span className="qv-numeric">{t('calculation.rightRail.days', { count: data.maxDrawdownDuration })}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {currDd !== 0 && (
          <div className="pt-2 border-t border-[var(--qv-border-subtle)]">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--qv-text-secondary)]">{t('calculation.rightRail.currentDrawdown')}</span>
              <SignedPercent value={currDd} className="text-sm" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpenPositionCard({ data }: { data: CalculationBreakdownResponse }) {
  const { t } = useTranslation('performance');
  const pmcValue = parseFloat(data.openPositionPnL.value);
  const pmcPct = parseFloat(data.openPositionPnL.percentage);
  const pmcCost = parseFloat(data.openPositionPnL.cost);
  const pmcMv = parseFloat(data.openPositionPnL.marketValue);
  const fifoValue = parseFloat(data.openPositionPnL.fifo.value);
  const fifoPct = parseFloat(data.openPositionPnL.fifo.percentage);
  const fifoCost = parseFloat(data.openPositionPnL.fifo.cost);

  if (pmcValue === 0 && pmcCost === 0) return null;

  return (
    <Card className="rounded-md">
      <CardContent className="p-4 space-y-3">
        <div className="qv-eyebrow text-[var(--qv-text-faint)]">{t('calculation.rightRail.openPosition')}</div>

        <div className="space-y-2">
          <div className="qv-eyebrow text-[10px] text-[var(--qv-text-faint)]">{t('calculation.rightRail.pmcConvention')}</div>
          <RailRow labelKey="calculation.rightRail.unrealizedPnl" value={pmcValue} format="signedCurrency" />
          <RailRow labelKey="calculation.deltaPercent" value={pmcPct} format="signedPercent" />
          <RailRow labelKey="calculation.rightRail.cost" value={pmcCost} format="currency" />
          <RailRow labelKey="calculation.rightRail.marketValue" value={pmcMv} format="currency" />
        </div>

        <div className="space-y-2 pt-2 border-t border-[var(--qv-border-subtle)]">
          <div className="qv-eyebrow text-[10px] text-[var(--qv-text-faint)]">{t('calculation.rightRail.fifoConvention')}</div>
          <RailRow labelKey="calculation.rightRail.unrealizedPnl" value={fifoValue} format="signedCurrency" />
          <RailRow labelKey="calculation.deltaPercent" value={fifoPct} format="signedPercent" />
          <RailRow labelKey="calculation.rightRail.cost" value={fifoCost} format="currency" />
        </div>
      </CardContent>
    </Card>
  );
}

function LastDayCard({ data }: { data: CalculationBreakdownResponse }) {
  const { t } = useTranslation('performance');
  const absChange = parseFloat(data.lastDayAbsoluteChange);
  const deltaValue = parseFloat(data.lastDayDeltaValue);
  const deltaPct = parseFloat(data.lastDayDelta);
  const perf = parseFloat(data.lastDayAbsolutePerformance);

  if (absChange === 0 && deltaValue === 0 && deltaPct === 0 && perf === 0) return null;

  return (
    <Card className="rounded-md">
      <CardContent className="p-4 space-y-2">
        <div className="qv-eyebrow text-[var(--qv-text-faint)]">{t('calculation.rightRail.lastDay')}</div>
        <RailRow labelKey="calculation.absoluteChange" value={absChange} format="signedCurrency" />
        <RailRow labelKey="calculation.delta" value={deltaValue} format="signedCurrency" />
        <RailRow labelKey="calculation.deltaPercent" value={deltaPct} format="signedPercent" />
      </CardContent>
    </Card>
  );
}

function RailRow({
  labelKey, value, format,
}: { labelKey: string; value: number; format: 'currency' | 'signedCurrency' | 'signedPercent' | 'percent' }) {
  const { t } = useTranslation('performance');
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--qv-text-secondary)]">{t(labelKey)}</span>
      {format === 'signedPercent' ? (
        <SignedPercent value={value} className="text-sm" />
      ) : format === 'percent' ? (
        <span className="qv-numeric text-sm text-[var(--qv-text-display)]">
          {(value * 100).toFixed(1)}%
        </span>
      ) : format === 'signedCurrency' ? (
        <CurrencyDisplay value={value} colorize className="qv-numeric text-sm" />
      ) : (
        <CurrencyDisplay value={value} className="qv-numeric text-sm" />
      )}
    </div>
  );
}
