import { z } from 'zod';
import { nonBlankString, isinString, tickerString } from './utils';

export const createSecuritySchema = z.object({
  name: nonBlankString(200),
  isin: isinString.optional(),
  // Tickers are NOT enforced unique: identical symbols on different exchanges
  // are legitimate (NYSE:AAPL vs LSE:AAPL ADR). ISIN is the global de-dupe key.
  ticker: tickerString.optional(),
  wkn: z.string().optional(),
  currency: z.string().length(3).default('EUR'),
  note: z.string().optional(),
  feedUrl: z.string().url().optional(),
  feed: z.string().optional(),
  pathToDate: z.string().optional(),
  pathToClose: z.string().optional(),
  pathToHigh: z.string().optional(),
  pathToLow: z.string().optional(),
  pathToVolume: z.string().optional(),
  dateFormat: z.string().optional(),
  dateTimezone: z.string().optional(),
  factor: z.number().optional(),
  calendar: z.string().optional(),
  isRetired: z.boolean().optional(),
  latestFeed: z.string().optional(),
  latestFeedUrl: z.string().optional(),
  feedTickerSymbol: z.string().optional(),
  onlineId: z.string().optional(),
});

/** Schema for a single item in the GET /api/securities list response. */
export const securityResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isin: z.string().nullable(),
  ticker: z.string().nullable(),
  wkn: z.string().nullable(),
  currency: z.string(),
  note: z.string().nullable(),
  isRetired: z.boolean(),
  feedUrl: z.string().nullable(),
  feed: z.string().nullable(),
  latestFeed: z.string().nullable(),
  latestFeedUrl: z.string().nullable(),
  latestDate: z.string().nullable(),
  latestPrice: z.number().nullable(),
  logoUrl: z.string().nullable(),
  shares: z.string(),
});

/** Schema for the GET /api/securities/:id detail response (superset of list item). */
export const securityDetailSchema = securityResponseSchema.extend({
  feedTickerSymbol: z.string().nullable(),
  feedProperties: z.record(z.string(), z.string()),
  calendar: z.string().nullable(),
  prices: z.array(z.object({ date: z.string(), value: z.string() })),
  attributes: z.array(z.object({
    typeId: z.string(),
    typeName: z.string(),
    value: z.string(),
  })),
  taxonomyAssignments: z.array(z.object({
    categoryId: z.string(),
    taxonomyId: z.string(),
    weight: z.number().nullable(),
  })),
});

export const updateSecurityAttributesSchema = z.object({
  attributes: z.array(z.object({
    typeId: z.string().min(1),
    value: z.string(),
  })),
});

export const updateSecurityTaxonomiesSchema = z.object({
  assignments: z.array(z.object({
    categoryId: z.string().min(1),
    taxonomyId: z.string().min(1),
    weight: z.number().nullable(),
  })),
}).refine(
  (data) => {
    // Group by taxonomyId and check sum <= 10000
    const byTaxonomy = new Map<string, number>();
    for (const a of data.assignments) {
      const current = byTaxonomy.get(a.taxonomyId) ?? 0;
      byTaxonomy.set(a.taxonomyId, current + (a.weight ?? 0));
    }
    for (const sum of byTaxonomy.values()) {
      if (sum > 10000) return false;
    }
    return true;
  },
  { message: 'Weight sum per taxonomy must not exceed 100%' },
);

export type CreateSecurityInput = z.infer<typeof createSecuritySchema>;
export type SecurityResponse = z.infer<typeof securityResponseSchema>;
export type SecurityDetailResponse = z.infer<typeof securityDetailSchema>;
export type UpdateSecurityAttributesInput = z.infer<typeof updateSecurityAttributesSchema>;
export type UpdateSecurityTaxonomiesInput = z.infer<typeof updateSecurityTaxonomiesSchema>;
