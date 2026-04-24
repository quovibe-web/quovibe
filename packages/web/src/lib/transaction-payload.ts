import { TransactionType } from '@/lib/enums';
import type { TransactionFormValues } from '@/components/domain/TransactionForm';

const PRICE_TYPES = new Set<TransactionType>([
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DELIVERY_OUTBOUND,
  TransactionType.SECURITY_TRANSFER,
]);

export function preparePayload(values: TransactionFormValues): Record<string, unknown> {
  const { price, securityId, accountId, crossAccountId, shares, amount, fees, taxes,
          fxRate, fxCurrencyCode, currencyCode, feesFx, taxesFx, ...rest } = values;
  const sharesNum = shares ? parseFloat(shares) : undefined;
  const priceNum = price ? parseFloat(price) : undefined;
  const feesNum = fees ? parseFloat(fees) : undefined;
  const taxesNum = taxes ? parseFloat(taxes) : undefined;
  const fxRateNum = fxRate ? parseFloat(fxRate) : undefined;
  const feesFxNum = feesFx ? parseFloat(feesFx) : undefined;
  const taxesFxNum = taxesFx ? parseFloat(taxesFx) : undefined;

  let amountNum: number;
  if (PRICE_TYPES.has(values.type) && sharesNum != null && priceNum != null) {
    amountNum = sharesNum * priceNum;
  } else {
    amountNum = parseFloat(amount ?? '0');
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
