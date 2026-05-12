import Decimal from 'decimal.js';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

export type WaterfallBarName = 'MVB' | 'Drivers' | 'Frictions' | 'Flows' | 'MVE';
export type WaterfallBarColor = 'secondary' | 'positive' | 'negative' | 'muted' | 'display';
export type CategoryId = 'anchors' | 'drivers' | 'frictions' | 'flows';

export interface WaterfallBar {
  name: WaterfallBarName;
  /** Where the bar starts on the Y axis. For anchors, always 0. For middle bars, the running total at the bar's start. */
  base: number;
  /** Signed height. Positive = bar grows up from base; negative = bar grows down from base. Anchors carry the full magnitude. */
  value: number;
  /** Magnitude (always non-negative) used for the magnitude-scale heuristic. */
  magnitude: number;
  color: WaterfallBarColor;
  /** Whether this bar is an anchor (MVB/MVE) vs a middle delta bar. */
  isAnchor: boolean;
}

export function buildWaterfallData(data: CalculationBreakdownResponse): WaterfallBar[] {
  const mvb = new Decimal(data.initialValue);
  const driversTotal = new Decimal(data.capitalGains.total)
    .plus(data.earnings.total)
    .plus(data.cashCurrencyGains.total);
  const frictionsTotal = new Decimal(data.fees.total).plus(data.taxes.total);
  const flowsTotal = new Decimal(data.performanceNeutralTransfers.total);
  const mve = new Decimal(data.finalValue);

  const postDrivers = mvb.plus(driversTotal);
  const postFrictions = postDrivers.minus(frictionsTotal);

  // Frictions display as negative (bar grows downward from the post-frictions level up to post-drivers).
  // Use negation only when non-zero to avoid -0 in JavaScript output.
  const frictionsDisplayValue = frictionsTotal.isZero()
    ? new Decimal(0)
    : frictionsTotal.neg();

  // Flows base: for negative flows, base is the lower endpoint (running total after delta);
  // for positive flows, base is the running total before the delta.
  const flowsValue = flowsTotal;
  const flowsBase = flowsValue.gte(0)
    ? postFrictions
    : postFrictions.plus(flowsValue);

  return [
    {
      name: 'MVB',
      base: 0,
      value: mvb.toNumber(),
      magnitude: mvb.abs().toNumber(),
      color: 'secondary',
      isAnchor: true,
    },
    {
      name: 'Drivers',
      base: mvb.toNumber(),
      value: driversTotal.toNumber(),
      magnitude: driversTotal.abs().toNumber(),
      color: 'positive',
      isAnchor: false,
    },
    {
      name: 'Frictions',
      base: postDrivers.minus(frictionsTotal).toNumber(),
      value: frictionsDisplayValue.toNumber(),
      magnitude: frictionsTotal.abs().toNumber(),
      color: 'negative',
      isAnchor: false,
    },
    {
      name: 'Flows',
      base: flowsBase.toNumber(),
      value: flowsValue.toNumber(),
      magnitude: flowsValue.abs().toNumber(),
      color: 'muted',
      isAnchor: false,
    },
    {
      name: 'MVE',
      base: 0,
      value: mve.toNumber(),
      magnitude: mve.abs().toNumber(),
      color: 'display',
      isAnchor: true,
    },
  ];
}

/**
 * Returns true when the ratio of the largest non-zero middle-bar magnitude
 * to the smallest non-zero middle-bar magnitude exceeds 30. When true, the
 * UI should offer a linear/log scale toggle so smaller delta bars don't
 * disappear next to an outsized one.
 *
 * Anchor bars (MVB/MVE) are excluded from the ratio: they represent absolute
 * portfolio values which are always large relative to individual period deltas,
 * and including them would cause the toggle to fire on almost every portfolio.
 */
export function shouldShowMagnitudeScaleToggle(bars: WaterfallBar[]): boolean {
  const middleMagnitudes = bars
    .filter((b) => !b.isAnchor)
    .map((b) => b.magnitude)
    .filter((m) => m > 0);
  if (middleMagnitudes.length < 2) return false;
  const max = Math.max(...middleMagnitudes);
  const min = Math.min(...middleMagnitudes);
  return max / min > 30;
}

const NAME_TO_CATEGORY: Record<WaterfallBarName, CategoryId> = {
  MVB: 'anchors',
  MVE: 'anchors',
  Drivers: 'drivers',
  Frictions: 'frictions',
  Flows: 'flows',
};

export function categoryIdForBar(name: string): CategoryId {
  if (!(name in NAME_TO_CATEGORY)) {
    throw new Error(`categoryIdForBar: unknown bar name "${name}"`);
  }
  return NAME_TO_CATEGORY[name as WaterfallBarName];
}
