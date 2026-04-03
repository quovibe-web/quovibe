import Decimal from 'decimal.js';
import { TransactionWithUnits, TransactionType, PORTFOLIO_CASHFLOW_TYPES, SECURITY_CASHFLOW_TYPES, Cashflow } from '@quovibe/shared';
import { getGrossAmount, getFees, getTaxes, getNetAmount } from '../helpers/transaction-amounts';

function isInflowAtPortfolioLevel(type: TransactionType): boolean {
  return type === TransactionType.DEPOSIT || type === TransactionType.DELIVERY_INBOUND;
}

function isInflowToSecurity(type: TransactionType): boolean {
  return type === TransactionType.BUY || type === TransactionType.DELIVERY_INBOUND;
}

export function resolvePortfolioCashflows(transactions: TransactionWithUnits[]): Cashflow[] {
  return transactions
    .filter((t) => (PORTFOLIO_CASHFLOW_TYPES as readonly TransactionType[]).includes(t.type))
    .map((t) => ({
      date: t.date,
      amount: isInflowAtPortfolioLevel(t.type) ? getNetAmount(t) : getNetAmount(t).negated(),
      type: t.type,
      accountId: undefined,
      securityId: t.securityId ?? undefined,
    }));
}

export function resolveSecurityCashflows(
  transactions: TransactionWithUnits[],
  securityId: string,
  includeTaxes = false,
): Cashflow[] {
  return transactions
    .filter(
      (t) =>
        t.securityId === securityId &&
        (SECURITY_CASHFLOW_TYPES as readonly TransactionType[]).includes(t.type) &&
        // Exclude cash-account counter-entries for BUY/SELL (shares=0): double-entry artifact
        // Note: shares===0 (explicit zero from DB) = cash side; shares===null = test mock, keep
        !((t.type === TransactionType.BUY || t.type === TransactionType.SELL) &&
          t.shares === 0),
    )
    .map((t) => {
      const gross = getGrossAmount(t);
      const fees = getFees(t);
      const taxes = getTaxes(t);

      let amount: Decimal;
      if (isInflowToSecurity(t.type)) {
        // Inflow (Buy, Delivery In): fees worsen performance → add fees to cost
        amount = gross.plus(fees);
        if (includeTaxes) amount = amount.plus(taxes);
      } else {
        // Outflow (Sell, Delivery Out, Dividend): fees reduce proceeds → subtract fees
        const proceeds = includeTaxes ? gross.minus(fees).minus(taxes) : gross.minus(fees);
        amount = proceeds.negated();
      }

      return {
        date: t.date,
        amount,
        type: t.type,
        securityId,
      };
    });
}
