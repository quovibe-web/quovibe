import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE');

// Positive decimal string (API numeric convention: values cross the wire as strings).
// No leading zeros: matches Decimal.toString() output, keeps GET->PUT round-trips stable.
const positiveDecimal = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, 'INVALID_VALUE')
  .refine((s) => parseFloat(s) > 0, 'INVALID_VALUE');

export const manualPriceSchema = z.object({
  date: isoDate,
  value: positiveDecimal,
  open: positiveDecimal.optional(),
  high: positiveDecimal.optional(),
  low: positiveDecimal.optional(),
  volume: z.number().int().nonnegative().optional(),
});

export const deletePricesSchema = z.object({
  // Omit the field entirely => delete-all sentinel. A present array must be non-empty.
  dates: z.array(isoDate).min(1).optional(),
});

export type ManualPriceInput = z.infer<typeof manualPriceSchema>;
export type DeletePricesInput = z.infer<typeof deletePricesSchema>;
