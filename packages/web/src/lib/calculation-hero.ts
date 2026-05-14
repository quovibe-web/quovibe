import type { CalculationBreakdownResponse } from '@quovibe/shared';

export type HeroTileId =
  | 'ttwror'
  | 'irr'
  | 'deltaPercent'
  | 'deltaAbsolute'
  | 'maxDrawdown'
  | 'sharpe';

export type HeroTileFormat = 'signedPercent' | 'signedCurrency' | 'neutralNumber';

export interface HeroTile {
  id: HeroTileId;
  /** i18n key for the eyebrow label */
  labelKey: string;
  /** Primary numeric value. null = render em-dash. */
  value: number | null;
  format: HeroTileFormat;
  /** Optional secondary numeric (e.g. p.a. rate on TTWROR tile). */
  subValue?: number | null;
  subFormat?: HeroTileFormat;
  /** Optional secondary text (e.g. IRR convergence error, "risk-adjusted return"). */
  subText?: string;
  /** Only set on the MaxDD tile. */
  peakDate?: string | null;
  troughDate?: string | null;
  durationDays?: number | null;
}

function parseFloatOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function extractHeroTiles(data: CalculationBreakdownResponse): HeroTile[] {
  return [
    {
      id: 'ttwror',
      labelKey: 'calculation.heroStrip.ttwror',
      value: parseFloatOrNull(data.ttwror),
      format: 'signedPercent',
      subValue: parseFloatOrNull(data.ttwrorPa),
      subFormat: 'signedPercent',
    },
    {
      id: 'irr',
      labelKey: 'calculation.heroStrip.irr',
      value: data.irrConverged ? parseFloatOrNull(data.irr) : null,
      format: 'signedPercent',
      subText: data.irrConverged ? undefined : (data.irrError ?? undefined),
    },
    {
      id: 'deltaPercent',
      labelKey: 'calculation.heroStrip.deltaPercent',
      value: parseFloatOrNull(data.delta),
      format: 'signedPercent',
    },
    {
      id: 'deltaAbsolute',
      labelKey: 'calculation.heroStrip.deltaAbsolute',
      value: parseFloatOrNull(data.deltaValue),
      format: 'signedCurrency',
    },
    {
      id: 'maxDrawdown',
      labelKey: 'calculation.heroStrip.maxDrawdown',
      value: parseFloatOrNull(data.maxDrawdown),
      format: 'signedPercent',
      peakDate: data.maxDrawdownPeakDate,
      troughDate: data.maxDrawdownTroughDate,
      durationDays: data.maxDrawdownDuration ?? null,
    },
    {
      id: 'sharpe',
      labelKey: 'calculation.heroStrip.sharpe',
      value: parseFloatOrNull(data.sharpeRatio),
      format: 'neutralNumber',
    },
  ];
}
