import { TransactionType } from '../enums';

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  currencyCode: string | null;
  amount: number | null;
  shares: number | null;
  note: string | null;
  securityId: string | null;
  source: string | null;
  updatedAt: string | null;
}

export interface TransactionUnit {
  id: string;
  transactionId: string;
  type: 'FEE' | 'TAX' | 'FOREX';
  amount: number;
  currencyCode: string | null;
  fxAmount: number | null;
  fxCurrencyCode: string | null;
  fxRate: number | null;
}

export interface TransactionWithUnits extends Transaction {
  units: TransactionUnit[];
}

export interface ReportingPeriod {
  id: string;
  name: string;
  start: string;
  end: string;
  isCustom: boolean;
}

export const DEFAULT_PERIODS = [
  { name: '1Y', months: 12 },
  { name: '2Y', months: 24 },
  { name: '3Y', months: 36 },
  { name: '5Y', months: 60 },
  { name: 'YTD', fromJanuary: true },
] as const;
