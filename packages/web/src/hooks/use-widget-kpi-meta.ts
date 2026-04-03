import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useReportingPeriod } from '@/api/use-performance';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
import { formatPeriodRange } from '@/lib/period-utils';

/**
 * Returns the period label and qualifier for KPI widgets.
 * - `periodLabel` — for LINE 4 (below the metric value)
 * - `qualifier` — for LINE 1 (next to the widget title, e.g. "cumulativo", "nel periodo")
 * @param qualifierKey - i18n key for the qualifier (e.g. 'widget.qualifier.cumulative')
 */
export function useWidgetKpiMeta(qualifierKey: string | null) {
  const { t, i18n } = useTranslation('dashboard');
  const { periodOverride } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const { showPaSuffix } = useDisplayPreferences();

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;
  // Hide the "annualized" / "p.a." qualifier when showPaSuffix is false
  const isAnnualizedQualifier = qualifierKey === 'widget.qualifier.annualized';
  const qualifier = qualifierKey && !(isAnnualizedQualifier && !showPaSuffix)
    ? t(qualifierKey)
    : '';
  const lang = i18n.language;

  const periodLabel = useMemo(
    () => formatPeriodRange(periodStart, periodEnd, lang),
    [periodStart, periodEnd, lang],
  );

  return { periodLabel, qualifier };
}
