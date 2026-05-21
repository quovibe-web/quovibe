import Decimal from 'decimal.js';

export interface Lot {
  date: string;
  shares: Decimal;
  pricePerShare: Decimal;
  totalCost: Decimal;
  /** sec→base on lot.date (multiply convention). Optional for single-ccy callers. */
  acquisitionRate?: Decimal;
  /** totalCost × acquisitionRate. Optional for single-ccy callers. */
  costInBase?: Decimal;
}

export interface ConsumedLotSlice {
  shares: Decimal;
  lotPricePerShare: Decimal;
  lotAcquisitionRate?: Decimal;
}

export interface CostTransaction {
  type: 'BUY' | 'SELL' | 'DELIVERY_INBOUND' | 'DELIVERY_OUTBOUND';
  date: string;
  shares: Decimal;
  grossAmount: Decimal;
  fees: Decimal;
}
