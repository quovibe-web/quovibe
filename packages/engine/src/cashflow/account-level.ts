import Decimal from 'decimal.js';
import { TransactionWithUnits, TransactionType, Cashflow } from '@quovibe/shared';
import { getGrossAmount, getFees, getTaxes } from '../helpers/transaction-amounts';

const ACCOUNT_INFLOW_TYPES: TransactionType[] = [
  TransactionType.DEPOSIT,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DIVIDEND,
  TransactionType.INTEREST,
  TransactionType.FEES_REFUND,
  TransactionType.TAX_REFUND,
];

export function resolveAccountCashflows(
  transactions: TransactionWithUnits[],
  accountId: string,
  includeTaxes = false,
): Cashflow[] {
  return transactions
    .filter(
      (t) =>
        t.securityId === accountId || (t as unknown as { accountId?: string }).accountId === accountId,
    )
    .filter((t) => t.type !== TransactionType.SECURITY_TRANSFER)
    .map((t) => {
      const gross = getGrossAmount(t);
      const fees = getFees(t);
      const taxes = getTaxes(t);
      const isInflow = ACCOUNT_INFLOW_TYPES.includes(t.type);

      let amount: Decimal;
      if (isInflow) {
        amount = gross.plus(fees);
        if (includeTaxes) amount = amount.plus(taxes);
      } else {
        amount = gross.minus(fees).negated();
        if (includeTaxes) amount = amount.minus(taxes);
      }

      return {
        date: t.date,
        amount,
        type: t.type,
        accountId,
      };
    });
}
