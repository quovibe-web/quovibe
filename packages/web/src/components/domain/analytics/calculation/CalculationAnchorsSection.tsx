import { forwardRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SignedPercent } from '@/components/shared/SignedPercent';
import { buildIdentityOperands, type IdentityOperand } from '@/lib/calculation-identity';
import type { CalculationBreakdownResponse } from '@quovibe/shared';
import { cn } from '@/lib/utils';

interface CalculationAnchorsSectionProps {
  data: CalculationBreakdownResponse;
}

export const CalculationAnchorsSection = forwardRef<HTMLDivElement, CalculationAnchorsSectionProps>(
  function CalculationAnchorsSection({ data }, ref) {
    const { t, i18n } = useTranslation('performance');
    const { operands, identity } = buildIdentityOperands(data, i18n.language, t);

    useEffect(() => {
      if (!identity.ok && import.meta.env.DEV) {
        console.warn(
          `[CalculationAnchorsSection] identity check failed: drift=${identity.drift}`,
        );
      }
    }, [identity.ok, identity.drift]);

    const mvb = parseFloat(data.initialValue);
    const mve = parseFloat(data.finalValue);
    const deltaAbs = mve - mvb;
    const deltaPct = mvb !== 0 ? deltaAbs / mvb : null;

    return (
      <Card ref={ref} className="rounded-md" id="calculation-section-anchors">
        <CardHeader className="pb-3">
          <div className="qv-eyebrow text-[var(--qv-text-faint)]">{t('calculation.categories.anchorsIdentity')}</div>
          <p className="text-sm text-muted-foreground mt-1">{t('calculation.categories.descriptions.anchorsIdentity')}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* MVB + MVE + Δ + Δ% grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <AnchorMetric labelKey="calculation.initialValue" value={mvb} format="currency" />
            <AnchorMetric labelKey="calculation.finalValue"   value={mve} format="currency" />
            <AnchorMetric labelKey="calculation.delta"        value={deltaAbs} format="signedCurrency" />
            <AnchorMetric labelKey="calculation.deltaPercent" value={deltaPct} format="signedPercent" />
          </div>

          {/* Identity equation chain */}
          <div className="border-t border-[var(--qv-border-subtle)] pt-4">
            <div className="qv-eyebrow text-[var(--qv-text-faint)] mb-3">{t('calculation.equation.identityCheck')}</div>
            <IdentityEquation operands={operands} identityOk={identity.ok} />
          </div>
        </CardContent>
      </Card>
    );
  },
);

function AnchorMetric({
  labelKey, value, format,
}: { labelKey: string; value: number | null; format: 'currency' | 'signedCurrency' | 'signedPercent' }) {
  const { t } = useTranslation('performance');
  return (
    <div className="space-y-1">
      <div className="qv-eyebrow text-[var(--qv-text-faint)]">{t(labelKey)}</div>
      {value === null ? (
        <span className="qv-numeric text-lg text-muted-foreground">—</span>
      ) : format === 'signedPercent' ? (
        <SignedPercent value={value} className="text-lg" />
      ) : format === 'signedCurrency' ? (
        <CurrencyDisplay value={value} colorize className="qv-numeric text-lg" />
      ) : (
        <CurrencyDisplay value={value} className="qv-numeric text-lg" />
      )}
    </div>
  );
}

function IdentityEquation({ operands, identityOk }: { operands: IdentityOperand[]; identityOk: boolean }) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-flex items-end gap-3 min-w-full">
        {operands.map((op, i) => (
          <div key={op.label} className="flex flex-col items-center gap-1">
            {i === operands.length - 1 && <span className="text-xs text-muted-foreground -mb-1">=</span>}
            <span
              className={cn('qv-numeric text-sm font-medium whitespace-nowrap', signColor(op.sign))}
            >
              {op.formattedValue}
            </span>
            <span className="qv-eyebrow text-[var(--qv-text-faint)] mt-0.5">{op.label}</span>
          </div>
        ))}
        <div className="self-center text-base ml-2">
          {identityOk ? '✓' : '~'}
        </div>
      </div>
    </div>
  );
}

function signColor(sign: 1 | -1 | 0): string {
  if (sign === 1) return 'text-[var(--qv-positive)]';
  if (sign === -1) return 'text-[var(--qv-negative)]';
  return 'text-[var(--qv-text-display)]';
}
