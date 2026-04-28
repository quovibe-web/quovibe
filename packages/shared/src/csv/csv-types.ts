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
  // Cross-currency columns. `amount` is the deposit-ccy net (wire "Value");
  // `grossAmount` is the security-ccy gross (wire "Gross Amount"); `fxRate`
  // is the wire "Exchange Rate" (deposit-per-security); `currencyGrossAmount`
  // is the security ccy code. All optional — required only when the row is
  // cross-currency. See `.claude/rules/csv-import.md` for the gate.
  'fxRate', 'grossAmount', 'currencyGrossAmount',
  // PP-parity accept-and-ignore columns. WKN: German-broker security
  // identifier, logged but not stored (no security.wkn column today).
  // Time: HH:MM intraday timestamp; the canonical `date` column wins.
  // Date of Quote: alternate spelling of `date` for price-import flow;
  // ignored on trade flow when the canonical `date` is mapped.
  'wkn', 'time', 'dateOfQuote',
  // Cross-currency fees/taxes. `feesFx` / `taxesFx` carry the
  // foreign-currency fee/tax magnitude (security ccy by default).
  // `feesCurrency` / `taxesCurrency` allow overriding the ccy code per
  // unit (rare — most brokers settle fees in the security ccy).
  'feesFx', 'taxesFx', 'feesCurrency', 'taxesCurrency',
] as const;
export type TradeColumnField = (typeof tradeColumnFields)[number];

// `type` is intentionally NOT required: when unmapped, parseTradeRow infers
// it via inferTransactionType (Account-mode rules). When mapped but the cell
// is empty/unknown, the strict UNKNOWN_TYPE error still fires.
export const requiredTradeColumns: readonly TradeColumnField[] = ['date', 'security', 'amount'];

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
  // Cross-currency CSV gate.
  // FX_RATE_REQUIRED: cross-ccy row with no Exchange Rate AND no rate cached.
  // INVALID_FX_RATE: Exchange Rate parsed as ≤ 0 or NaN.
  // FX_VERIFICATION_FAILED: |Gross × Rate − Value| above wire-step-2 tolerance.
  // CURRENCY_MISMATCH: Currency Gross Amount ≠ resolved security.currency.
  'FX_RATE_REQUIRED', 'INVALID_FX_RATE', 'FX_VERIFICATION_FAILED', 'CURRENCY_MISMATCH',
  // Inventory-feasibility gate: outflow (SELL, DELIVERY_OUTBOUND, source-side
  // SECURITY_TRANSFER) exceeds the shares available at that point in time,
  // considering existing DB holdings plus cumulative same-CSV deltas applied
  // in chronological order.
  'INSUFFICIENT_SHARES',
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
  amount: number;           // deposit-ccy bare cost (wire "Value")
  fees?: number;
  taxes?: number;
  currency?: string;
  note?: string;
  crossAccountId?: string;  // destination account for SECURITY_TRANSFER / TRANSFER_BETWEEN_ACCOUNTS
  // Cross-currency channel.
  // fxRate: qv convention (security-per-deposit), inverted from the wire
  //   `Exchange Rate` column at parse time via `ppRateToQvRate`.
  // grossAmount: security-ccy gross (wire "Gross Amount"). Used for the FOREX
  //   xact_unit's `forex_amount` and `Gross × Rate = Value` verification.
  // currencyGrossAmount: security ccy code, pinned against the resolved
  //   security.currency for CURRENCY_MISMATCH detection.
  fxRate?: number;
  grossAmount?: number;
  currencyGrossAmount?: string;
  // Cross-currency fees/taxes. Optional. Numeric magnitudes are
  // in their respective currencies (NOT pre-converted to the deposit ccy).
  // Mapper applies `/ fxRate` to compute the deposit-ccy equivalent for
  // FEE/TAX `xact_unit.amount`, and stores the foreign-ccy magnitude in
  // `xact_unit.forex_amount`. Mirrors transaction.service.ts:247-270.
  feesFx?: number;
  taxesFx?: number;
  feesCurrency?: string;
  taxesCurrency?: string;
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
  // Server-side autodetect output. Wizard treats any null field as "user
  // must pick" rather than overriding the dropdown defaults; an empty
  // `columnMapping` likewise leaves the user's existing mapping untouched.
  // Shape mirrors `AutodetectResult` in `csv-autodetect.ts` — keep in sync.
  autodetected?: {
    dateFormat: CsvDateFormat | null;
    decimalSeparator: '.' | ',' | null;
    thousandSeparator: '' | '.' | ',' | ' ' | null;
    columnMapping: Record<string, number>;
  };
}

export interface UnmatchedSecurity {
  csvName: string;
  csvIsin?: string;
  csvTicker?: string;
  suggestedMatch?: { id: string; name: string; isin: string };
  /**
   * Distinct, sorted, uppercased ISO-4217 codes seen in the
   * `currencyGrossAmount` column across all CSV rows whose security name
   * resolves to this csvName. Empty/absent → CGA column not mapped or
   * blank everywhere. Used by the client to pre-populate the new-security
   * currency picker.
   */
  csvCurrencies?: string[];
}

export interface TradePreviewResult {
  rows: PreviewRow[];
  unmatchedSecurities: UnmatchedSecurity[];
  errors: RowError[];
  summary: {
    total: number;
    valid: number;
    errors: number;
    /** CSV rows whose natural key already exists in xact (source='CSV_IMPORT'). */
    duplicates: number;
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
  /** Rows skipped because their natural key already exists. Default 0. */
  skippedDuplicates: number;
  created: { transactions: number; securities: number };
  errors: RowError[];
}

export interface PriceExecuteResult {
  inserted: number;
  skipped: number;
  errors: RowError[];
  dateRange: { from: string; to: string };
}
