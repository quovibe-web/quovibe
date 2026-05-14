import Decimal from 'decimal.js';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

// formatCurrency decision: option (b) — inline Intl.NumberFormat.
// formatters.ts `formatCurrency` reads i18n.language internally and has no locale param,
// so we use Intl.NumberFormat directly here to keep this module pure and testable in
// the node-env vitest setup without a DOM / i18n instance.

export interface IdentityCheck {
  ok: boolean;
  drift: number;
}

export interface IdentityOperand {
  /** i18n-localized short label ("MVB", "Drivers", …). */
  label: string;
  /** Sign-aware locale-aware formatted currency string. Includes leading sign for non-anchors. */
  formattedValue: string;
  /** 1 = positive (colorize green), -1 = negative (colorize red), 0 = anchor (neutral). */
  sign: 1 | -1 | 0;
}

const TOLERANCE = 0.01;

/**
 * Verify that MVB + Drivers − Frictions + Flows = MVE within 0.01 currency-unit tolerance.
 *
 * Identity:
 *   initialValue
 *   + capitalGains.total + earnings.total + cashCurrencyGains.total  (Drivers)
 *   − fees.total − taxes.total                                        (Frictions)
 *   + performanceNeutralTransfers.total                                (Flows)
 *   = finalValue
 */
export function validateIdentity(data: CalculationBreakdownResponse): IdentityCheck {
  // drift = MVE − (MVB + Drivers − Frictions + Flows)
  // Positive drift means finalValue exceeds the computed sum (too large).
  // Negative drift means finalValue is below the computed sum (too small).
  const computed = new Decimal(data.initialValue)
    .plus(data.capitalGains.total)
    .plus(data.earnings.total)
    .plus(data.cashCurrencyGains.total)
    .minus(data.fees.total)
    .minus(data.taxes.total)
    .plus(data.performanceNeutralTransfers.total);
  const drift = new Decimal(data.finalValue).minus(computed).toNumber();
  return { ok: Math.abs(drift) < TOLERANCE, drift };
}

function signFor(value: Decimal): 1 | -1 | 0 {
  if (value.isZero()) return 0;
  return value.gt(0) ? 1 : -1;
}

function localeCurrency(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a Decimal as a signed locale currency string.
 * - withSign=false (anchors): bare currency format, no leading sign.
 * - withSign=true, zero: bare currency format (sign=0, no prefix).
 * - withSign=true, positive: U+002B '+' prefix.
 * - withSign=true, negative: U+2212 '−' prefix (MINUS SIGN, not HYPHEN-MINUS).
 */
function formatSigned(
  value: Decimal,
  locale: string,
  currency: string,
  withSign: boolean,
): string {
  const absoluteValue = value.abs().toNumber();
  const base = localeCurrency(absoluteValue, currency, locale);
  if (!withSign || value.isZero()) return base;
  return value.gt(0) ? `+${base}` : `−${base}`;
}

/**
 * Build the 5-operand array for the MVB + Drivers − Frictions + Flows = MVE equation
 * and attach the identity verification result.
 *
 * Operand order: MVB → Drivers → Frictions → Flows → MVE.
 *
 * Sign semantics:
 *   - MVB, MVE: sign=0 (anchors, rendered neutral).
 *   - Drivers: sign follows the sign of the total (positive → green, negative → red).
 *   - Frictions: always sign=-1 when non-zero (costs are always negative in meaning).
 *   - Flows: sign follows the sign of the total (net deposit positive → green).
 */
export function buildIdentityOperands(
  data: CalculationBreakdownResponse,
  locale: string,
  t: (key: string) => string,
): { operands: IdentityOperand[]; identity: IdentityCheck } {
  const mvb = new Decimal(data.initialValue);
  const driversTotal = new Decimal(data.capitalGains.total)
    .plus(data.earnings.total)
    .plus(data.cashCurrencyGains.total);
  const frictionsTotal = new Decimal(data.fees.total).plus(data.taxes.total);
  const flowsTotal = new Decimal(data.performanceNeutralTransfers.total);
  const mve = new Decimal(data.finalValue);
  const baseCurrency = data.baseCurrency;

  const operands: IdentityOperand[] = [
    {
      label: t('calculation.equation.labelMvb'),
      formattedValue: formatSigned(mvb, locale, baseCurrency, false),
      sign: 0,
    },
    {
      label: t('calculation.equation.labelDrivers'),
      formattedValue: formatSigned(driversTotal, locale, baseCurrency, true),
      sign: signFor(driversTotal),
    },
    {
      // Frictions are always a cost; display as unsigned absolute with '−' prefix when non-zero.
      label: t('calculation.equation.labelFrictions'),
      formattedValue: frictionsTotal.isZero()
        ? localeCurrency(0, baseCurrency, locale)
        : `−${localeCurrency(frictionsTotal.toNumber(), baseCurrency, locale)}`,
      sign: frictionsTotal.isZero() ? 0 : -1,
    },
    {
      label: t('calculation.equation.labelFlows'),
      formattedValue: formatSigned(flowsTotal, locale, baseCurrency, true),
      sign: signFor(flowsTotal),
    },
    {
      label: t('calculation.equation.labelMve'),
      formattedValue: formatSigned(mve, locale, baseCurrency, false),
      sign: 0,
    },
  ];

  return { operands, identity: validateIdentity(data) };
}
