export interface YoYDeltaResult {
  delta: number;
  isUp: boolean;
  priorTotal: number;
}

export function computeYoYDelta(
  currentTotal: number,
  priorTotal: number | null,
): YoYDeltaResult | null {
  if (priorTotal === null || priorTotal <= 0) return null;
  const delta = (currentTotal - priorTotal) / priorTotal;
  return { delta, isUp: delta >= 0, priorTotal };
}

export function formatPeakLabel(bucket: string, monthsShort: string[]): string {
  const m = /^(\d{4})-(\d{2})$/.exec(bucket);
  if (!m) return bucket;
  const year = m[1];
  const month = parseInt(m[2], 10);
  const monthName = monthsShort[month - 1] ?? '';
  return `${monthName} ${year}`;
}

export interface AverageDeltaResult {
  delta: number;
  isUp: boolean;
}

export function computeAverageDelta(
  currentTotal: number,
  currentMonths: number,
  priorTotal: number | null,
  priorMonths: number,
): AverageDeltaResult | null {
  if (priorTotal === null || priorMonths <= 0 || currentMonths <= 0) return null;
  const currentAvg = currentTotal / currentMonths;
  const priorAvg = priorTotal / priorMonths;
  const delta = currentAvg - priorAvg;
  return { delta, isUp: delta >= 0 };
}
