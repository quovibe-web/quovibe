import { TransactionType } from '@/lib/enums';
import type { TransactionFormValues } from '@/components/domain/TransactionForm';

const PRICE_TYPES = new Set<TransactionType>([
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DELIVERY_OUTBOUND,
]);

export function preparePayload(values: TransactionFormValues): Record<string, unknown> {
  const { price, securityId, accountId, crossAccountId, shares, amount, fees, taxes, ...rest } = values;
  const sharesNum = shares ? parseFloat(shares) : undefined;
  const priceNum = price ? parseFloat(price) : undefined;
  const feesNum = fees ? parseFloat(fees) : undefined;
  const taxesNum = taxes ? parseFloat(taxes) : undefined;
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
  };
}
