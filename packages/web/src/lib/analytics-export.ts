/**
 * CSV export helper for the Analytics / Calculation breakdown.
 *
 * Pure function — no DOM, no React imports. Accepts the pre-fetched data and
 * a translation function; returns a UTF-8 BOM-prefixed CSV string ready for
 * download. Columns: Section, Subsection, Amount.
 *
 * Two sections in the output:
 *  1. Breakdown rows (from CALCULATION_ROWS) with optional sub-items.
 *  2. Summary metrics (TTWROR, IRR, volatility, drawdown, etc.).
 */
import type { TFunction } from 'i18next';
import type { CalculationBreakdownResponse } from '@quovibe/shared';
import { CALCULATION_ROWS } from '@/lib/calculation-rows';

/**
 * Escape a single CSV cell value.
 * - null / undefined → empty string
 * - strings with commas, quotes, or newlines → double-quoted with escaped inner quotes
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...values: Array<string | number | null | undefined>): string {
  return values.map(cell).join(',');
}

/**
 * Build a CSV string from a `CalculationBreakdownResponse`.
 *
 * @param data     - API response from `useCalculation`.
 * @param t        - `useTranslation('performance').t` from the calling component.
 * @param irrOk    - Whether IRR converged (controls whether IRR value is included).
 * @returns UTF-8 BOM-prefixed CSV string.
 */
export function buildCalculationCsv(
  data: CalculationBreakdownResponse,
  t: TFunction,
  irrOk: boolean,
): string {
  const BOM = '﻿';
  const lines: string[] = [];

  // Header — fixed English labels (consumed by spreadsheet tools, not translated)
  lines.push(row('Section', 'Subsection', 'Amount'));

  // -----------------------------------------------------------------------
  // Section 1 — Breakdown rows
  // -----------------------------------------------------------------------
  for (const rowDef of CALCULATION_ROWS) {
    const total = rowDef.extractTotal(data);
    if (total === null) continue;

    const displayTotal = rowDef.negate ? (-parseFloat(total)).toString() : total;
    const sectionLabel = t(rowDef.i18nKey);

    // Section total row (no subsection)
    lines.push(row(sectionLabel, '', displayTotal));

    // Sub-items (if any)
    if (rowDef.extractItems) {
      const items = rowDef.extractItems(data);
      for (const item of items) {
        const itemLabel = item.i18nKey ? t(item.i18nKey) : item.label;
        const itemAmount = rowDef.negate ? (-parseFloat(item.amount)).toString() : item.amount;
        lines.push(row(sectionLabel, itemLabel, itemAmount));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Section 2 — Summary metrics
  // -----------------------------------------------------------------------
  const metricsSection = 'Metrics';

  lines.push(row(metricsSection, t('calculation.ttwror'), formatPct(data.ttwror)));
  lines.push(row(metricsSection, t('calculation.ttwrorPa'), formatPct(data.ttwrorPa)));
  lines.push(
    row(
      metricsSection,
      t('calculation.irrAnn'),
      irrOk && data.irr !== null ? formatPct(data.irr) : '',
    ),
  );
  lines.push(row(metricsSection, t('calculation.absoluteChange'), data.absoluteChange));
  lines.push(row(metricsSection, t('calculation.delta'), data.delta));

  // Risk metrics — labels from dashboard ns (they have no equivalent in performance ns)
  lines.push(row(metricsSection, 'Volatility', data.volatility !== null ? formatPct(data.volatility) : ''));
  lines.push(row(metricsSection, 'Semivariance', data.semivariance !== null ? formatPct(data.semivariance) : ''));
  lines.push(
    row(
      metricsSection,
      'Sharpe Ratio',
      data.sharpeRatio !== null ? data.sharpeRatio : '',
    ),
  );
  lines.push(row(metricsSection, 'Maximum Drawdown', formatPct(data.maxDrawdown)));
  lines.push(row(metricsSection, 'Current Drawdown', formatPct(data.currentDrawdown)));
  lines.push(
    row(
      metricsSection,
      'Max Drawdown Duration (days)',
      data.maxDrawdownDuration !== null ? String(data.maxDrawdownDuration) : '',
    ),
  );

  return BOM + lines.join('\r\n');
}

/** Convert a fractional percentage string (e.g. "0.0312") to percentage display ("3.12"). */
function formatPct(value: string): string {
  const n = parseFloat(value);
  if (isNaN(n)) return '';
  // Multiply by 100 to get percentage points; keep 4 decimal places for precision
  return (n * 100).toFixed(4); // native-ok — display formatting
}

/**
 * Trigger a browser download of the given CSV string.
 */
export function downloadCalculationCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Slugify a portfolio name for use in a filename.
 * Replaces non-alphanumeric characters with hyphens and trims leading/trailing hyphens.
 */
export function slugifyFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
