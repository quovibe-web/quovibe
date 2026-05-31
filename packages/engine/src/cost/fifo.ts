import Decimal from 'decimal.js';
import { CostTransaction, Lot, ConsumedLotSlice } from './types';
import { SplitEvent, applySplitAdjustment } from './split';
import { getRateFromMap, type RateMap } from '../fx/rate-map';

export interface FIFOResult {
  remainingLots: Lot[];
  realizedGain: Decimal;
  unrealizedGain: Decimal;
  averagePurchasePrice: Decimal;
  purchaseValue: Decimal;
  /** Populated only when rateMap is supplied. Slices in chronological FIFO-consumption order. */
  consumedSlices?: ConsumedLotSlice[];
  /**
   * Populated only when rateMap is supplied. BUY dates that had no rate entry in
   * rateMap — their lots carry `acquisitionRate = undefined` and decomposition
   * would silently substitute ONE. Callers MUST check this array is empty before
   * feeding `consumedSlices` / `remainingLots` into `decomposeRealized` /
   * `decomposeUnrealized`.
   */
  unresolvedBuyDates?: string[];
}

export interface FIFOOptions {
  /** sec→base rate map (multiply convention). When supplied, lots gain acquisitionRate + costInBase. */
  rateMap?: RateMap;
}

export function computeFIFO(
  transactions: CostTransaction[],
  currentPrice?: Decimal,
  splitEvents?: SplitEvent[],
  opts?: FIFOOptions,
): FIFOResult {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const pendingSplits = splitEvents
    ? [...splitEvents].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const lots: Lot[] = [];
  let realizedGain = new Decimal(0);
  let appliedSplitIdx = 0;
  const rateMap = opts?.rateMap;
  const consumedSlices: ConsumedLotSlice[] | undefined = rateMap ? [] : undefined;
  const unresolvedBuyDates: string[] | undefined = rateMap ? [] : undefined;

  for (const tx of sorted) {
    // Apply any split events that occur before or on this transaction's date
    while (
      appliedSplitIdx < pendingSplits.length &&
      pendingSplits[appliedSplitIdx].date <= tx.date
    ) {
      applySplitAdjustment(lots, [pendingSplits[appliedSplitIdx]]);
      appliedSplitIdx++;
    }

    if (tx.type === 'BUY' || tx.type === 'DELIVERY_INBOUND' || tx.type === 'SECURITY_TRANSFER_INBOUND') {
      if (tx.shares.lte(0)) {
        throw new Error(`${tx.type} transaction must have positive shares (got ${tx.shares})`);
      }
      const totalCost = tx.grossAmount.plus(tx.fees);
      const pricePerShare = totalCost.div(tx.shares);
      const acquisitionRate = rateMap ? (getRateFromMap(rateMap, tx.date) ?? undefined) : undefined;
      const costInBase = acquisitionRate ? totalCost.mul(acquisitionRate) : undefined;
      if (rateMap && !acquisitionRate) {
        // unresolvedBuyDates is non-null exactly when rateMap is supplied
        unresolvedBuyDates!.push(tx.date);
      }
      lots.push({
        date: tx.date,
        shares: tx.shares,
        pricePerShare,
        totalCost,
        ...(acquisitionRate ? { acquisitionRate } : {}),
        ...(costInBase ? { costInBase } : {}),
      });
    } else if (tx.type === 'SELL' || tx.type === 'DELIVERY_OUTBOUND' || tx.type === 'SECURITY_TRANSFER_OUTBOUND') {
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
        if (consumedSlices) {
          consumedSlices.push({
            shares: consumed,
            lotPricePerShare: lot.pricePerShare,
            ...(lot.acquisitionRate ? { lotAcquisitionRate: lot.acquisitionRate } : {}),
          });
        }
        lot.shares = lot.shares.minus(consumed);
        lot.totalCost = lot.shares.mul(lot.pricePerShare);
        if (lot.costInBase && lot.acquisitionRate) {
          lot.costInBase = lot.shares.mul(lot.pricePerShare).mul(lot.acquisitionRate);
        }
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

  return {
    remainingLots: lots,
    realizedGain,
    unrealizedGain,
    averagePurchasePrice,
    purchaseValue,
    ...(consumedSlices ? { consumedSlices } : {}),
    ...(unresolvedBuyDates ? { unresolvedBuyDates } : {}),
  };
}
