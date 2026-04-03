import Decimal from 'decimal.js';

export interface Lot {
  date: string;
  shares: Decimal;
  pricePerShare: Decimal;
  totalCost: Decimal;
}

export interface CostTransaction {
  type: 'BUY' | 'SELL' | 'DELIVERY_INBOUND' | 'DELIVERY_OUTBOUND';
  date: string;
  shares: Decimal;
  grossAmount: Decimal;
  fees: Decimal;
}
