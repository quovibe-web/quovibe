import { z } from 'zod';

/**
 * Preview and apply share one body. `newShares` / `oldShares` are the two
 * sides of a `new:old` ratio; a 1-for-25 reverse split is
 * `{newShares: 1, oldShares: 25}`.
 */
export const stockSplitSchema = z
  .object({
    securityId: z.string().uuid(),
    exDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'exDate must be YYYY-MM-DD'),
    newShares: z.number().positive().finite(),
    oldShares: z.number().positive().finite(),
    changeTransactions: z.boolean().default(true),
    changeHistoricalQuotes: z.boolean().default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    // A 1:1 split moves nothing and would leave a meaningless marker.
    if (data.newShares === data.oldShares) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Split ratio must not be 1:1',
        path: ['newShares'],
      });
    }
  });

export type StockSplitInput = z.infer<typeof stockSplitSchema>;
