import type { TransactionUnit } from '@/api/types';

/**
 * Compute deposit-currency amounts from cross-currency FX data.
 * All inputs are plain numbers; no side effects.
 */
export function computeFxAmounts(params: {
  isCrossCurrency: boolean;
  fxRate: number;
  grossSecurity: number;
  feesFx: number;
  taxesFx: number;
  feesDeposit: number;
  taxesDeposit: number;
}) {
  const { isCrossCurrency, fxRate, grossSecurity, feesFx, taxesFx, feesDeposit, taxesDeposit } = params;
  const canConvert = isCrossCurrency && fxRate > 0;
  const grossDeposit = canConvert ? grossSecurity / fxRate : grossSecurity;
  const feesFxDeposit = canConvert ? feesFx / fxRate : 0;
  const taxesFxDeposit = canConvert ? taxesFx / fxRate : 0;
  return {
    grossDeposit,
    feesFxDeposit,
    taxesFxDeposit,
    totalFees: feesDeposit + feesFxDeposit,
    totalTaxes: taxesDeposit + taxesFxDeposit,
  };
}

/**
 * Extract FX restoration data (exchange rate, security-ccy gross + fees/taxes)
 * from a transaction's unit array.
 *
 * `grossSecurity` — FOREX unit's forexAmount: security-ccy gross in decimal
 * form (e.g. 495.04 for $495.04). Undefined for same-currency transactions.
 */
export function extractFxFromUnits(units: TransactionUnit[] | undefined) {
  const forexUnit = units?.find((u) => u.type === 'FOREX');
  const feeUnit = units?.find((u) => u.type === 'FEE');
  const taxUnit = units?.find((u) => u.type === 'TAX');
  return {
    fxRate: forexUnit?.exchangeRate ?? '',
    grossSecurity: forexUnit?.forexAmount != null && forexUnit.forexAmount > 0 ? forexUnit.forexAmount : undefined,
    feesFx: feeUnit?.forexAmount && feeUnit.forexAmount > 0 ? String(feeUnit.forexAmount) : '',
    taxesFx: taxUnit?.forexAmount && taxUnit.forexAmount > 0 ? String(taxUnit.forexAmount) : '',
  };
}

/**
 * Derives the initial price-per-share string for edit dialogs.
 *
 * Cross-currency rows: use security-ccy gross from the FOREX unit so the
 * form field is in the correct currency. Same-currency rows: back-compute
 * from the deposit-ccy amount. `feeSign` is -1 for BUY (amount includes
 * fees+taxes) and +1 for SELL (amount excludes fees+taxes).
 */
export function deriveInitialPrice(
  grossSecurity: number | undefined,
  sharesNum: number,
  depositAmount: number,
  feeAmount: number,
  taxAmount: number,
  feeSign: -1 | 1,
): string {
  if (sharesNum <= 0) return '';
  if (grossSecurity != null) return String(grossSecurity / sharesNum);
  const gross = depositAmount + feeSign * (feeAmount + taxAmount);
  return String(gross / sharesNum);
}
