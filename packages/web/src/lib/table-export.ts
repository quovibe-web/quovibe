/**
 * CSV export utility for TanStack Table instances.
 *
 * Exports visible columns in the current column/sort order with raw accessor
 * values (not rendered cell content). Produces a UTF-8 BOM-prefixed CSV file
 * that opens correctly in Excel across all locales.
 */
import type { Table } from '@tanstack/react-table';

export interface ExportOptions {
  /** Override filename (without extension). Default: `{tableId}_{YYYY-MM-DD}` */
  filename?: string;
}

/**
 * Format a value for CSV output.
 * - null / undefined → empty string
 * - Date objects → ISO date string
 * - strings that look like ISO dates → kept as-is
 * - numbers → full precision string (no currency symbol)
 * - booleans → "true" / "false"
 * - strings containing commas, quotes, or newlines → double-quoted with escaped inner quotes
 */
function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10); // native-ok — date index
  }

  if (typeof value === 'number') {
    if (isNaN(value)) return '';
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  const str = String(value);
  // Escape CSV special characters
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Resolve the display header for a column (i18n-translated string).
 * Falls back to column id if header is a render function.
 */
function resolveHeader<TData>(col: ReturnType<Table<TData>['getVisibleLeafColumns']>[number]): string {
  const headerDef = col.columnDef.header;
  if (typeof headerDef === 'string') return headerDef;
  // For render-function headers, fall back to column id
  return col.id;
}

/**
 * Build a CSV string from a TanStack Table instance.
 *
 * - Exports only visible columns (respects columnVisibility)
 * - Exports in current column order (respects columnOrder)
 * - Exports in current sort order (respects sorting)
 * - Uses raw accessor values, not rendered cell content
 * - UTF-8 BOM prefix for Excel compatibility
 *
 * Exported separately for testability (no DOM dependency).
 */
export function buildCsvContent<TData>(table: Table<TData>): string | null {
  const visibleColumns = table.getVisibleLeafColumns()
    .filter(col => {
      // Exclude action/locked columns with no meaningful data
      const meta = col.columnDef.meta as { locked?: boolean } | undefined;
      return !meta?.locked;
    });

  if (visibleColumns.length === 0) return null;

  // Header row — translated column names
  const headers = visibleColumns.map(col => formatCsvValue(resolveHeader(col)));

  // Data rows — sorted rows from the table model, raw accessor values
  const rows = table.getSortedRowModel().rows;
  const dataLines = rows.map(row => {
    return visibleColumns.map(col => {
      const value = row.getValue(col.id);
      return formatCsvValue(value);
    }).join(',');
  });

  // Assemble CSV with UTF-8 BOM
  const BOM = '\uFEFF';
  return BOM + [headers.join(','), ...dataLines].join('\r\n');
}

function downloadCsv(csv: string, tableId: string, options?: ExportOptions): void {
  const date = new Date().toISOString().slice(0, 10); // native-ok — date index
  const filename = options?.filename ?? `${tableId}_${date}`;
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
 * Export a TanStack Table to CSV and trigger a browser download.
 */
export function exportTableToCSV<TData>(
  table: Table<TData>,
  tableId: string,
  options?: ExportOptions,
): void {
  const csv = buildCsvContent(table);
  if (!csv) return;
  downloadCsv(csv, tableId, options);
}

/**
 * Build a CSV string from raw row data, using a TanStack Table only for
 * column metadata (visibility / order / headers). Each row is read via the
 * column's `accessorFn` if defined, otherwise via its `accessorKey`.
 *
 * Used by the server-paginated export path (BUG-60): the table holds only
 * the current page, but the CSV must cover the full filtered dataset
 * fetched on demand.
 */
export function buildCsvFromRows<TData>(
  table: Table<TData>,
  rows: TData[],
): string | null {
  const visibleColumns = table.getVisibleLeafColumns()
    .filter(col => {
      const meta = col.columnDef.meta as { locked?: boolean } | undefined;
      return !meta?.locked;
    });

  if (visibleColumns.length === 0) return null;

  const headers = visibleColumns.map(col => formatCsvValue(resolveHeader(col)));

  const dataLines = rows.map((row, idx) => {
    return visibleColumns.map(col => {
      const def = col.columnDef as {
        accessorKey?: string;
        accessorFn?: (row: TData, index: number) => unknown;
      };
      let value: unknown;
      if (typeof def.accessorFn === 'function') {
        value = def.accessorFn(row, idx);
      } else if (def.accessorKey) {
        value = (row as Record<string, unknown>)[def.accessorKey];
      } else {
        value = (row as Record<string, unknown>)[col.id];
      }
      return formatCsvValue(value);
    }).join(',');
  });

  const BOM = '﻿';
  return BOM + [headers.join(','), ...dataLines].join('\r\n');
}

/**
 * Export an externally-fetched row set to CSV using a TanStack Table for
 * column metadata. Pair with `buildCsvFromRows`.
 */
export function exportRowsToCSV<TData>(
  table: Table<TData>,
  rows: TData[],
  tableId: string,
  options?: ExportOptions,
): void {
  const csv = buildCsvFromRows(table, rows);
  if (!csv) return;
  downloadCsv(csv, tableId, options);
}
