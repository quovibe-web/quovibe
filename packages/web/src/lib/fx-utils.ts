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
 * Extract FX restoration data (exchange rate, security-ccy fees/taxes)
 * from a transaction's unit array.
 */
export function extractFxFromUnits(units: TransactionUnit[] | undefined) {
  const forexUnit = units?.find((u) => u.type === 'FOREX');
  const feeUnit = units?.find((u) => u.type === 'FEE');
  const taxUnit = units?.find((u) => u.type === 'TAX');
  return {
    fxRate: forexUnit?.exchangeRate ?? '',
    feesFx: feeUnit?.forexAmount && feeUnit.forexAmount > 0 ? String(feeUnit.forexAmount) : '',
    taxesFx: taxUnit?.forexAmount && taxUnit.forexAmount > 0 ? String(taxUnit.forexAmount) : '',
  };
}
