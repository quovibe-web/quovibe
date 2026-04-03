import Decimal from 'decimal.js';
import { Lot } from './types';

export interface SplitEvent {
  date: string;
  ratio: Decimal;
  securityId: string;
}

export function parseSplitRatio(ratioStr: string): Decimal {
  const [numerator, denominator] = ratioStr.split(':');
  return new Decimal(numerator).div(new Decimal(denominator));
}

export function applySplitAdjustment(lots: Lot[], events: SplitEvent[]): Lot[] {
  for (const event of events) {
    if (event.ratio.lte(0)) {
      throw new Error(`Split ratio must be positive (got ${event.ratio})`);
    }
    for (const lot of lots) {
      if (lot.date < event.date) {
        lot.shares = lot.shares.mul(event.ratio);
        lot.pricePerShare = lot.pricePerShare.div(event.ratio);
        // totalCost is invariant
      }
    }
  }
  return lots;
}
