import Decimal from 'decimal.js';
import { TransactionType } from './enums';

export type CashflowLevel = 'PORTFOLIO' | 'SECURITY_ACCOUNT' | 'SECURITY';

export interface Cashflow {
  date: string;
  amount: Decimal;   // positive = inflow, negative = outflow
  type: TransactionType;
  securityId?: string;
  accountId?: string;
}
