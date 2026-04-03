import Decimal from 'decimal.js';
import { CostTransaction, Lot } from './types';
import { SplitEvent, applySplitAdjustment } from './split';

export interface FIFOResult {
  remainingLots: Lot[];
  realizedGain: Decimal;
  unrealizedGain: Decimal;
  averagePurchasePrice: Decimal;
  purchaseValue: Decimal;
}

export function computeFIFO(
  transactions: CostTransaction[],
  currentPrice?: Decimal,
  splitEvents?: SplitEvent[],
): FIFOResult {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const pendingSplits = splitEvents
    ? [...splitEvents].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const lots: Lot[] = [];
  let realizedGain = new Decimal(0);
  let appliedSplitIdx = 0;

  for (const tx of sorted) {
    // Apply any split events that occur before or on this transaction's date
    while (
      appliedSplitIdx < pendingSplits.length &&
      pendingSplits[appliedSplitIdx].date <= tx.date
    ) {
      applySplitAdjustment(lots, [pendingSplits[appliedSplitIdx]]);
      appliedSplitIdx++;
    }

    if (tx.type === 'BUY' || tx.type === 'DELIVERY_INBOUND') {
      if (tx.shares.lte(0)) {
        throw new Error(`${tx.type} transaction must have positive shares (got ${tx.shares})`);
      }
      const totalCost = tx.grossAmount.plus(tx.fees);
      const pricePerShare = totalCost.div(tx.shares);
      lots.push({ date: tx.date, shares: tx.shares, pricePerShare, totalCost });
    } else if (tx.type === 'SELL' || tx.type === 'DELIVERY_OUTBOUND') {
      if (tx.shares.lte(0)) {
        throw new Error(`${tx.type} transaction must have positive shares (got ${tx.shares})`);
      }
      const sellPricePerShare = tx.grossAmount.div(tx.shares);
      let sharesToSell = tx.shares;

      while (sharesToSell.gt(0) && lots.length > 0) {
        const lot = lots[0];
        const consumed = Decimal.min(sharesToSell, lot.shares);
        realizedGain = realizedGain.plus(
          consumed.mul(sellPricePerShare.minus(lot.pricePerShare)),
        );
        lot.shares = lot.shares.minus(consumed);
        lot.totalCost = lot.shares.mul(lot.pricePerShare);
        sharesToSell = sharesToSell.minus(consumed);
        if (lot.shares.isZero()) {
          lots.shift();
        }
      }
    }
  }

  // Apply any remaining splits (after all transactions)
  while (appliedSplitIdx < pendingSplits.length) {
    applySplitAdjustment(lots, [pendingSplits[appliedSplitIdx]]);
    appliedSplitIdx++;
  }

  const purchaseValue = lots.reduce((sum, lot) => sum.plus(lot.totalCost), new Decimal(0));
  const totalShares = lots.reduce((sum, lot) => sum.plus(lot.shares), new Decimal(0));
  const averagePurchasePrice = totalShares.isZero()
    ? new Decimal(0)
    : purchaseValue.div(totalShares);

  const unrealizedGain =
    currentPrice && !totalShares.isZero()
      ? totalShares.mul(currentPrice).minus(purchaseValue)
      : new Decimal(0);

  return { remainingLots: lots, realizedGain, unrealizedGain, averagePurchasePrice, purchaseValue };
}
