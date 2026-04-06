// packages/shared/src/csv/csv-types.ts
import { z } from 'zod';

// ─── CSV Import Configuration ──────────────────────

export const csvDelimiters = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof csvDelimiters)[number];

export const csvEncodings = ['utf-8', 'iso-8859-1', 'windows-1252'] as const;
export type CsvEncoding = (typeof csvEncodings)[number];

export const csvDateFormats = ['yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd.MM.yyyy'] as const;
export type CsvDateFormat = (typeof csvDateFormats)[number];

export const csvImportTypes = ['TRADES', 'PRICES'] as const;
export type CsvImportType = (typeof csvImportTypes)[number];

export interface CsvImportConfig {
  id: string;
  name: string;
  type: CsvImportType;
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
  skipLines: number;
  dateFormat: CsvDateFormat;
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';
  columnMapping: Record<string, number>;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Zod Schemas ──────────────────────────────────

export const csvImportConfigSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(csvImportTypes),
  delimiter: z.enum(csvDelimiters),
  encoding: z.enum(csvEncodings),
  skipLines: z.number().int().min(0).default(0),
  dateFormat: z.enum(csvDateFormats),
  decimalSeparator: z.enum(['.', ',']),
  thousandSeparator: z.enum(['', '.', ',', ' ']),
  columnMapping: z.record(z.string(), z.number().int().min(0)),
});

export type CreateCsvImportConfigInput = z.infer<typeof csvImportConfigSchema>;

// ─── Trade Column Mapping ─────────────────────────

export const tradeColumnFields = [
  'date', 'type', 'security', 'shares', 'amount',
  'fees', 'taxes', 'currency', 'note', 'isin', 'ticker', 'crossAccount',
] as const;
export type TradeColumnField = (typeof tradeColumnFields)[number];

export const requiredTradeColumns: readonly TradeColumnField[] = ['date', 'type', 'security', 'amount'];

// ─── Price Column Mapping ─────────────────────────

export const priceColumnFields = ['date', 'close', 'high', 'low', 'volume'] as const;
export type PriceColumnField = (typeof priceColumnFields)[number];

export const requiredPriceColumns: readonly PriceColumnField[] = ['date', 'close'];

// ─── Row Error ────────────────────────────────────

export const csvErrorCodes = [
  'INVALID_DATE', 'INVALID_NUMBER', 'MISSING_REQUIRED',
  'UNKNOWN_TYPE', 'INVALID_PRICE', 'NEGATIVE_SHARES',
  'MISSING_SECURITY', 'MISSING_SHARES', 'DUPLICATE_DATE',
  'MISSING_CROSS_ACCOUNT',
] as const;
export type CsvErrorCode = (typeof csvErrorCodes)[number];

export interface RowError {
  row: number;
  column?: string;
  value?: string;
  code: CsvErrorCode;
  message: string;
}

// ─── Normalized Row ───────────────────────────────

export interface NormalizedTradeRow {
  rowNumber: number;
  date: string;             // "YYYY-MM-DD"
  type: string;             // TransactionType enum value
  securityName: string;
  isin?: string;
  ticker?: string;
  shares?: number;
  amount: number;           // gross amount, always positive
  fees?: number;
  taxes?: number;
  currency?: string;
  note?: string;
  crossAccountId?: string;  // destination account for SECURITY_TRANSFER / TRANSFER_BETWEEN_ACCOUNTS
}

export interface NormalizedPriceRow {
  rowNumber: number;
  date: string;             // "YYYY-MM-DD"
  close: number;
  high?: number;
  low?: number;
  volume?: number;
}

// ─── Preview / Result Types ───────────────────────

export interface CsvParseResult {
  tempFileId: string;
  headers: string[];
  sampleRows: string[][];
  detectedDelimiter: CsvDelimiter;
  totalRows: number;
}

export interface UnmatchedSecurity {
  csvName: string;
  csvIsin?: string;
  csvTicker?: string;
  suggestedMatch?: { id: string; name: string; isin: string };
}

export interface TradePreviewResult {
  rows: PreviewRow[];
  unmatchedSecurities: UnmatchedSecurity[];
  errors: RowError[];
  summary: {
    total: number;
    valid: number;
    errors: number;
    byType: Record<string, number>;
  };
}

export interface PreviewRow {
  rowNumber: number;
  date: string;
  type: string;
  securityName: string;
  shares?: number;
  amount: number;
  fees?: number;
  taxes?: number;
  currency?: string;
  note?: string;
  error?: RowError;
}

export interface TradeExecuteResult {
  imported: number;
  created: { transactions: number; securities: number };
  errors: RowError[];
}

export interface PriceExecuteResult {
  inserted: number;
  skipped: number;
  errors: RowError[];
  dateRange: { from: string; to: string };
}
