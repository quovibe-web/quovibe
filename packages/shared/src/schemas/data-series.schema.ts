import { z } from 'zod';

export const dataSeriesValueSchema = z.discriminatedUnion('type', [
  // preTax removed from UI; narrowed to false to reject stale serialized data
  z.object({ type: z.literal('portfolio'), preTax: z.literal(false).default(false) }),
  z.object({ type: z.literal('account'), accountId: z.string().min(1), withReference: z.boolean() }),
  z.object({ type: z.literal('taxonomy'), taxonomyId: z.string().min(1), categoryId: z.string().min(1).optional() }),
  z.object({ type: z.literal('security'), securityId: z.string().min(1) }),
]);

export type DataSeriesValueInput = z.infer<typeof dataSeriesValueSchema>;
