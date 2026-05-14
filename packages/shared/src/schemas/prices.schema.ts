import { z } from 'zod';

/** Payload schema for importing historical price data for a security. */
export const importPricesSchema = z.object({
  prices: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    close: z.string().min(1),
    high: z.string().optional(),
    low: z.string().optional(),
    volume: z.number().optional(),
  })).min(1),
});

export type ImportPricesInput = z.infer<typeof importPricesSchema>;
