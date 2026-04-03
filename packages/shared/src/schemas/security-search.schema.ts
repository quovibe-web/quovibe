import { z } from 'zod';
import { InstrumentType } from '../enums';

// ─── Request schemas ─────────────────────────────────────────────────────────

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
});

export const previewPricesSchema = z.object({
  ticker: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ─── Response schemas ────────────────────────────────────────────────────────

export const instrumentTypeEnum = z.nativeEnum(InstrumentType);

export const searchResultSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  type: instrumentTypeEnum,
  exchange: z.string(),
  exchDisp: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
});

export const searchResultsResponseSchema = z.array(searchResultSchema);

export const previewPriceSchema = z.object({
  date: z.string(),
  close: z.string(),
  high: z.string().optional(),
  low: z.string().optional(),
  volume: z.number().optional(),
});

export const previewPricesResponseSchema = z.object({
  currency: z.string(),
  prices: z.array(previewPriceSchema),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type PreviewPricesInput = z.infer<typeof previewPricesSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type PreviewPrice = z.infer<typeof previewPriceSchema>;
export type PreviewPricesResponse = z.infer<typeof previewPricesResponseSchema>;
