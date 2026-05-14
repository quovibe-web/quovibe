import { z } from 'zod';
import { csvDelimiters, csvDateFormats } from '../csv/csv-types';

// Wire-body schemas for /api/p/:pid/csv-import/trades/{reparse,preview,execute}.
//
// dateFormat + separators are narrowed to the UI-exposed sets so a malformed
// payload produces 400 INVALID_INPUT instead of a 500 from the downstream
// parser (same failure class as BUG-46 on the body side rather than the
// multer side).

export const reparseTradesSchema = z.object({
  tempFileId: z.string().min(1),
  delimiter: z.enum(csvDelimiters).optional(),
  skipLines: z.number().int().min(0).optional(),
}).strict();

const columnMappingSchema = z.record(z.string(), z.number().int().min(0));
const decimalSeparatorSchema = z.enum(['.', ',']);
const thousandSeparatorSchema = z.enum(['', '.', ',', ' ']);
const dateFormatSchema = z.enum(csvDateFormats);

export const tradePreviewSchema = z.object({
  tempFileId: z.string().min(1),
  delimiter: z.enum(csvDelimiters).optional(),
  columnMapping: columnMappingSchema,
  dateFormat: dateFormatSchema,
  decimalSeparator: decimalSeparatorSchema,
  thousandSeparator: thousandSeparatorSchema,
  targetSecuritiesAccountId: z.string().min(1),
  securityMapping: z.record(z.string(), z.string().min(1)).optional(),
  newSecurityNames: z.array(z.string().min(1)).optional(),
}).strict();

export const tradeExecuteSchema = z.object({
  tempFileId: z.string().min(1),
  config: z.object({
    // Client omits delimiter on execute; .default(',') keeps the wire field
    // optional but narrows the parsed output to CsvDelimiter so the service's
    // required delimiter param accepts it. Same value csv-reader already
    // falls back to.
    delimiter: z.enum(csvDelimiters).default(','),
    columnMapping: columnMappingSchema,
    dateFormat: dateFormatSchema,
    decimalSeparator: decimalSeparatorSchema,
    thousandSeparator: thousandSeparatorSchema,
  }).strict(),
  targetSecuritiesAccountId: z.string().min(1),
  securityMapping: z.record(z.string(), z.string().min(1)),
  newSecurities: z.array(z.object({
    name: z.string().min(1),
    isin: z.string().optional(),
    ticker: z.string().optional(),
    currency: z.string().min(1),
  }).strict()),
  excludedRows: z.array(z.number().int().min(1)),
}).strict();

export type ReparseTradesInput = z.infer<typeof reparseTradesSchema>;
export type TradePreviewInput = z.infer<typeof tradePreviewSchema>;
export type TradeExecuteInput = z.infer<typeof tradeExecuteSchema>;
