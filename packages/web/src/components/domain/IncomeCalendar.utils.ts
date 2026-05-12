export const SPARKBAR_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

export interface MonthlyAveragesResult {
  averages: number[];   // length 12, index 0 = Jan
  maxAverage: number;
}

export function computeMonthlyAverages(
  cells: Map<number, Map<number, { total: number }>>,
): MonthlyAveragesResult {
  const sums = new Array(12).fill(0) as number[];
  const counts = new Array(12).fill(0) as number[];
  for (const monthMap of cells.values()) {
    for (const [month, cell] of monthMap.entries()) {
      sums[month - 1] += cell.total;
      counts[month - 1] += 1;
    }
  }
  const averages = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
  const maxAverage = averages.reduce((m, v) => (v > m ? v : m), 0);
  return { averages, maxAverage };
}

export interface YearDeltaResult {
  delta: number;
  isUp: boolean;
}

export function computeYearDelta(
  year: number,
  yearTotals: Map<number, number>,
): YearDeltaResult | null {
  const prior = yearTotals.get(year - 1);
  const current = yearTotals.get(year);
  if (prior === undefined || prior <= 0 || current === undefined) return null;
  const delta = (current - prior) / prior;
  return { delta, isUp: delta >= 0 };
}

export function sparkbarIndex(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  const ratio = Math.min(value / max, 1);
  return Math.floor(ratio * (SPARKBAR_GLYPHS.length - 1));
}
