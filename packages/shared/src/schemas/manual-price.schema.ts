import { z } from 'zod';

/** True only for a real calendar date in YYYY-MM-DD form (rejects 2025-13-40, 2025-02-30). */
export function isRealCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE')
  .refine(isRealCalendarDate, 'INVALID_DATE');

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
