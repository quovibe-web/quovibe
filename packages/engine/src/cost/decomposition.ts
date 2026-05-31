import Decimal from 'decimal.js';
import type { Lot, ConsumedLotSlice } from './types';

const ONE = new Decimal(1);
const ZERO = new Decimal(0);

export interface DecompositionResult {
  capitalBase: Decimal;
  forexBase: Decimal;
}

/**
 * Splits a SELL into capital-gain and FX-gain components, both in base currency.
 *
 *   capital = sum(shares * (sellPrice - lotPrice) * sellRate)
 *   forex   = sum(shares * lotPrice * (sellRate - lotRate))
 *
 * Algebraic identity per slice:
 *   capital + forex = (sellPrice * sellRate - lotPrice * lotRate) * shares
 *                   = sellValueInBase - costInBase
 *
 * For single-ccy consumers, slices lacking lotAcquisitionRate are treated as
 * rate=1 and sellRate should be passed as 1 — collapses to pure capital.
 */
export function decomposeRealized(
  slices: ConsumedLotSlice[],
  sellPrice: Decimal,
  sellRate: Decimal,
): DecompositionResult {
  let capital = ZERO;
  let forex = ZERO;
  for (const slice of slices) {
    const lotRate = slice.lotAcquisitionRate ?? ONE;
    capital = capital.plus(slice.shares.mul(sellPrice.minus(slice.lotPricePerShare)).mul(sellRate));
    forex = forex.plus(slice.shares.mul(slice.lotPricePerShare).mul(sellRate.minus(lotRate)));
  }
  return { capitalBase: capital, forexBase: forex };
}

/**
 * Splits open-position unrealized P&L into capital + FX components, both in base.
 *
 *   capital = sum(shares * (currentPrice - lotPrice) * currentRate)
 *   forex   = sum(shares * lotPrice * (currentRate - lotRate))
 *
 * Identity: capital + forex = mvBase - costBase.
 */
export function decomposeUnrealized(
  lots: Lot[],
  currentPrice: Decimal,
  currentRate: Decimal,
): DecompositionResult {
  let capital = ZERO;
  let forex = ZERO;
  for (const lot of lots) {
    const lotRate = lot.acquisitionRate ?? ONE;
    capital = capital.plus(lot.shares.mul(currentPrice.minus(lot.pricePerShare)).mul(currentRate));
    forex = forex.plus(lot.shares.mul(lot.pricePerShare).mul(currentRate.minus(lotRate)));
  }
  return { capitalBase: capital, forexBase: forex };
}
