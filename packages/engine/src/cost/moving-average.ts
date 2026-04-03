import Decimal from 'decimal.js';
import { CostTransaction } from './types';
import { SplitEvent } from './split';

export interface MovingAverageResult {
  averagePurchasePrice: Decimal;
  purchaseValue: Decimal;
  realizedGain: Decimal;
  unrealizedGain: Decimal;
  totalShares: Decimal;
}

export function computeMovingAverage(
  transactions: CostTransaction[],
  currentPrice?: Decimal,
  splitEvents?: SplitEvent[],
): MovingAverageResult {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const pendingSplits = splitEvents
    ? [...splitEvents].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  let totalShares = new Decimal(0);
  let totalCost = new Decimal(0);
  let realizedGain = new Decimal(0);
  let appliedSplitIdx = 0;

  for (const tx of sorted) {
    // Apply any split events that occur before or on this transaction's date
    while (
      appliedSplitIdx < pendingSplits.length &&
      pendingSplits[appliedSplitIdx].date <= tx.date
    ) {
      const ratio = pendingSplits[appliedSplitIdx].ratio;
      totalShares = totalShares.mul(ratio);
      // totalCost is invariant; avgPrice adjusts implicitly
      appliedSplitIdx++;
    }

    if (tx.type === 'BUY' || tx.type === 'DELIVERY_INBOUND') {
      if (tx.shares.lte(0)) {
        throw new Error(`${tx.type} transaction must have positive shares (got ${tx.shares})`);
      }
      totalCost = totalCost.plus(tx.grossAmount).plus(tx.fees);
      totalShares = totalShares.plus(tx.shares);
    } else if (tx.type === 'SELL' || tx.type === 'DELIVERY_OUTBOUND') {
      const avgPrice = totalShares.isZero() ? new Decimal(0) : totalCost.div(totalShares);
      const costBasis = tx.shares.mul(avgPrice);
      realizedGain = realizedGain.plus(tx.grossAmount.minus(costBasis));
      totalShares = totalShares.minus(tx.shares);
      if (totalShares.lt(0)) {
        throw new Error(`Sold more shares than available: ${tx.shares} sold, only ${totalShares.plus(tx.shares)} held`);
      }
      totalCost = totalShares.mul(avgPrice);
    }
  }

  const averagePurchasePrice = totalShares.isZero()
    ? new Decimal(0)
    : totalCost.div(totalShares);

  const purchaseValue = totalCost;

  const unrealizedGain =
    currentPrice && !totalShares.isZero()
      ? totalShares.mul(currentPrice).minus(purchaseValue)
      : new Decimal(0);

  return { averagePurchasePrice, purchaseValue, realizedGain, unrealizedGain, totalShares };
}
