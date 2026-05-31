export type { Lot, CostTransaction, ConsumedLotSlice } from './types';
export type { FIFOResult } from './fifo';
export type { MovingAverageResult } from './moving-average';
export type { SplitEvent } from './split';
export type { DecompositionResult } from './decomposition';
export { computeFIFO } from './fifo';
export { computeMovingAverage } from './moving-average';
export { parseSplitRatio, applySplitAdjustment } from './split';
export { decomposeRealized, decomposeUnrealized } from './decomposition';
