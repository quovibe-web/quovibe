/**
 * CSV export for the Accounts page.
 *
 * AccountsHub renders cards/summary, not a TanStack Table, so it cannot reuse
 * `exportTableToCSV`. This helper builds the same UTF-8 BOM-prefixed shape
 * over `AccountListItem[]` directly. Pure (no DOM); see `downloadAccountsCsv`
 * for the side-effecting wrapper.
 */
import type { AccountListItem } from '@/api/types';

export interface AccountsCsvHeaders {
  name: string;
  type: string;
  currency: string;
  balance: string;
  transactionCount: string;
}

export interface AccountsCsvTypeLabels {
  portfolio: string;
  deposit: string;
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  return escapeCsv(value);
}

/**
 * Build CSV string for the accounts list.
 *
 * Columns (in order): name, type, currency, balance, transactionCount.
 * - balance is exported as raw decimal-string (no currency symbol, no thousand
 *   separators) so the file is machine-readable across locales.
 * - type cell resolves through `typeLabels` so the export matches the user's
 *   active language.
 * - retired accounts are included. The caller controls whether to pre-filter.
 */
export function buildAccountsCsv(
  accounts: AccountListItem[],
  headers: AccountsCsvHeaders,
  typeLabels: AccountsCsvTypeLabels,
): string {
  const headerRow = [
    headers.name,
    headers.type,
    headers.currency,
    headers.balance,
    headers.transactionCount,
  ].map(escapeCsv).join(',');

  const dataRows = accounts.map((a) => {
    const typeLabel = a.type === 'portfolio' ? typeLabels.portfolio : typeLabels.deposit;
    return [
      formatCell(a.name),
      formatCell(typeLabel),
      formatCell(a.currency),
      formatCell(a.balance),
      formatCell(a.transactionCount),
    ].join(',');
  });

  const BOM = '﻿';
  return BOM + [headerRow, ...dataRows].join('\r\n');
}

/**
 * Trigger a browser download for the given CSV string.
 */
export function downloadAccountsCsv(csv: string, filename: string): void {
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
