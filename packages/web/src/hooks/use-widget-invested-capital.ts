import Decimal from 'decimal.js';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useReportingPeriod, usePerformanceSecurities } from '@/api/use-performance';

/**
 * Pure helper: sums purchaseValue strings from a securities list.
 * Exported for unit testing. Uses Decimal.js — no native float arithmetic.
 */
export function sumPurchaseValues(
  securities: { purchaseValue: string }[],
): string {
  return securities
    .reduce(
      (sum, sec) => sum.plus(new Decimal(sec.purchaseValue)),
      new Decimal(0),
    )
    .toString();
}

/**
 * Aggregates total invested capital for the active widget period.
 * Period override from WidgetConfigContext takes priority over the URL period.
 */
export function useWidgetInvestedCapital() {
  const { periodOverride } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;

  const { data, isLoading, isError } = usePerformanceSecurities({ periodStart, periodEnd });

  const investedCapital = data ? sumPurchaseValues(data) : '0';

  return { investedCapital, isLoading, isError };
}
