import { PRICED_SHARE_TYPES } from '@quovibe/shared';
import type { TransactionFormValues } from '@/components/domain/TransactionForm';
import { normalizeDecimalInput } from '@/lib/decimal-input';

export function preparePayload(values: TransactionFormValues): Record<string, unknown> {
  const { price, securityId, accountId, crossAccountId, shares, amount, fees, taxes,
          fxRate, fxCurrencyCode, currencyCode, feesFx, taxesFx, ...rest } = values;
  // The schema accepts a locale comma ("1,5") after normalizeDecimalInput, so the
  // wire payload MUST normalize identically — a bare parseFloat("1,5") posts 1 and
  // silently drops the fraction. Mirrors price-history's toWirePayload.
  const num = (s: string | undefined): number | undefined =>
    s ? parseFloat(normalizeDecimalInput(s)) : undefined;
  const sharesNum = num(shares);
  const priceNum = num(price);
  const feesNum = num(fees);
  const taxesNum = num(taxes);
  const fxRateNum = num(fxRate);
  const feesFxNum = num(feesFx);
  const taxesFxNum = num(taxesFx);

  let amountNum: number;
  if (PRICED_SHARE_TYPES.has(values.type) && sharesNum != null && priceNum != null) {
    amountNum = sharesNum * priceNum;
  } else {
    amountNum = parseFloat(normalizeDecimalInput(amount ?? '0'));
  }
  return {
    ...rest,
    amount: amountNum,
    ...(sharesNum != null ? { shares: sharesNum } : {}),
    ...(feesNum != null && feesNum > 0 ? { fees: feesNum } : {}),
    ...(taxesNum != null && taxesNum > 0 ? { taxes: taxesNum } : {}),
    ...(securityId ? { securityId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(crossAccountId ? { crossAccountId } : {}),
    ...(fxRateNum != null && fxRateNum > 0 ? { fxRate: fxRateNum } : {}),
    ...(fxCurrencyCode ? { fxCurrencyCode } : {}),
    ...(currencyCode ? { currencyCode } : {}),
    ...(feesFxNum != null && feesFxNum > 0 ? { feesFx: feesFxNum } : {}),
    ...(taxesFxNum != null && taxesFxNum > 0 ? { taxesFx: taxesFxNum } : {}),
  };
}
