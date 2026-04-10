import { TrendingUp, Shield, Banknote, LayoutGrid, type LucideIcon } from 'lucide-react';
import { getWidgetDef } from './widget-registry';
import { nanoid } from 'nanoid';
import type { DashboardWidget } from '@quovibe/shared';

export interface DashboardTemplate {
  id: string;
  i18nKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  widgetTypes: string[];
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: 'performance',
    i18nKey: 'templates.performance',
    descriptionKey: 'templates.performanceDesc',
    icon: TrendingUp,
    widgetTypes: ['market-value', 'ttwror', 'delta', 'irr', 'absolute-performance', 'perf-chart'],
  },
  {
    id: 'risk',
    i18nKey: 'templates.risk',
    descriptionKey: 'templates.riskDesc',
    icon: Shield,
    widgetTypes: ['max-drawdown', 'current-drawdown', 'volatility', 'semivariance', 'sharpe-ratio', 'drawdown-chart'],
  },
  {
    id: 'income',
    i18nKey: 'templates.income',
    descriptionKey: 'templates.incomeDesc',
    icon: Banknote,
    widgetTypes: ['invested-capital', 'market-value', 'delta', 'absolute-change', 'returns-heatmap'],
  },
  {
    id: 'complete',
    i18nKey: 'templates.complete',
    descriptionKey: 'templates.completeDesc',
    icon: LayoutGrid,
    widgetTypes: ['market-value', 'ttwror', 'irr', 'delta', 'perf-chart', 'drawdown-chart', 'max-drawdown', 'volatility', 'sharpe-ratio', 'movers'],
  },
];

/** Generate a DashboardWidget array from a template, with fresh IDs and registry defaults */
export function applyTemplate(template: DashboardTemplate): DashboardWidget[] {
  return template.widgetTypes
    .map((type) => {
      const def = getWidgetDef(type);
      if (!def) return null;
      return {
        id: nanoid(),
        type,
        title: null,
        span: def.defaultSpan,
        config: structuredClone(def.defaultConfig),
      } satisfies DashboardWidget;
    })
    .filter((w): w is DashboardWidget => w !== null);
}
