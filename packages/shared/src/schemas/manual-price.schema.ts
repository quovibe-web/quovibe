import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE');

// Positive decimal string (API numeric convention: values cross the wire as strings).
const positiveDecimal = z
  .string()
  .refine((s) => /^\d+(\.\d+)?$/.test(s) && parseFloat(s) > 0, 'INVALID_VALUE');

export const manualPriceSchema = z.object({
  date: isoDate,
  value: positiveDecimal,
  open: positiveDecimal.optional(),
  high: positiveDecimal.optional(),
  low: positiveDecimal.optional(),
  volume: z.number().int().nonnegative().optional(),
});

export const deletePricesSchema = z.object({
  // Omit (or empty) => delete-all sentinel. A present array deletes those dates.
  dates: z.array(isoDate).optional(),
});

export type ManualPriceInput = z.infer<typeof manualPriceSchema>;
export type DeletePricesInput = z.infer<typeof deletePricesSchema>;
