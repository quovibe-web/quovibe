import type { PortfolioCalcResponse } from '../api/types';

export type MetricId = 'mv' | 'irr' | 'ttwror' | 'ttwrorPa' | 'delta' | 'absPerf' | 'absChange';

export interface MetricValue {
  primary: number;
  secondary?: number;
  irrConverged?: boolean;
}

export interface MetricDefinition {
  id: MetricId;
  labelKey: string;
  descriptionKey: string;
  format: 'currency' | 'percentage' | 'currency+pct';
  colorize: boolean;
  getValue: (calc: PortfolioCalcResponse) => MetricValue;
}

export const METRIC_REGISTRY: MetricDefinition[] = [
  {
    id: 'mv',
    labelKey: 'metrics.mv',
    descriptionKey: 'metrics.mvDescription',
    format: 'currency',
    colorize: false,
    getValue: (calc) => ({ primary: parseFloat(calc.finalValue) }),
  },
  {
    id: 'irr',
    labelKey: 'metrics.irr',
    descriptionKey: 'metrics.irrDescription',
    format: 'percentage',
    colorize: true,
    getValue: (calc) => ({
      primary: calc.irr != null ? parseFloat(calc.irr) : 0,
      irrConverged: calc.irrConverged,
    }),
  },
  {
    id: 'ttwror',
    labelKey: 'metrics.ttwror',
    descriptionKey: 'metrics.ttwrorDescription',
    format: 'percentage',
    colorize: true,
    getValue: (calc) => ({ primary: parseFloat(calc.ttwror) }),
  },
  {
    id: 'ttwrorPa',
    labelKey: 'metrics.ttwrorPa',
    descriptionKey: 'metrics.ttwrorPaDescription',
    format: 'percentage',
    colorize: true,
    getValue: (calc) => ({ primary: parseFloat(calc.ttwrorPa) }),
  },
  {
    id: 'delta',
    labelKey: 'metrics.delta',
    descriptionKey: 'metrics.deltaDescription',
    format: 'currency+pct',
    colorize: true,
    getValue: (calc) => ({
      primary: parseFloat(calc.deltaValue),
      secondary: parseFloat(calc.delta),
    }),
  },
  {
    id: 'absPerf',
    labelKey: 'metrics.absPerf',
    descriptionKey: 'metrics.absPerfDescription',
    format: 'currency+pct',
    colorize: true,
    getValue: (calc) => ({
      primary: parseFloat(calc.absolutePerformance),
      secondary: parseFloat(calc.absolutePerformancePct),
    }),
  },
  {
    id: 'absChange',
    labelKey: 'metrics.absChange',
    descriptionKey: 'metrics.absChangeDescription',
    format: 'currency',
    colorize: true,
    getValue: (calc) => ({ primary: parseFloat(calc.absoluteChange) }),
  },
];

export const DEFAULT_METRIC_IDS: MetricId[] = ['mv', 'irr', 'ttwrorPa', 'delta', 'absPerf'];
