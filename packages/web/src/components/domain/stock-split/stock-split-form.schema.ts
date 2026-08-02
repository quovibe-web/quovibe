import { z } from 'zod';
import { normalizeDecimalInput } from '@/lib/decimal-input';
import type { SplitRequestBody } from '@/api/use-stock-split';

// Form values are all strings: number inputs surface '' while the user is
// mid-edit, and the wire schema takes numbers. Conversion happens in
// toSplitRequest on submit, mirroring the price-entry form.
export type SplitFormValues = {
  securityId: string;
  exDate: string;
  oldShares: string;
  newShares: string;
};

export type Translator = (key: string) => string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toPositiveNumber(input: string): number | null {
  const normalized = normalizeDecimalInput(input);
  if (normalized === '') return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Every message is already translated: shadcn's FormMessage renders
 * String(error.message) with no t(), so raw keys would surface to the user.
 */
export function buildSplitFormSchema(t: Translator) {
  return z
    .object({
      securityId: z.string().min(1, t('split.errors.securityRequired')),
      exDate: z.string().regex(DATE_RE, t('split.errors.invalidDate')),
      oldShares: z
        .string()
        .refine((s) => toPositiveNumber(s) !== null, t('split.errors.invalidRatioSide')),
      newShares: z
        .string()
        .refine((s) => toPositiveNumber(s) !== null, t('split.errors.invalidRatioSide')),
    })
    .superRefine((data, ctx) => {
      const newShares = toPositiveNumber(data.newShares);
      const oldShares = toPositiveNumber(data.oldShares);
      if (newShares !== null && oldShares !== null && newShares === oldShares) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('split.errors.noOpRatio'),
          path: ['newShares'],
        });
      }
    });
}

/**
 * Pure direction label for the live sentence under the two ratio fields.
 * Returns an i18n key plus interpolation values — never a rendered string —
 * so the caller owns the t() call.
 */
export function describeSplit(values: { newShares: string; oldShares: string }): {
  key: string;
  values: Record<string, string>;
} | null {
  const newShares = toPositiveNumber(values.newShares);
  const oldShares = toPositiveNumber(values.oldShares);
  if (newShares === null || oldShares === null) return null;

  const interpolation = { oldShares: String(oldShares), newShares: String(newShares) };
  if (newShares === oldShares) return { key: 'split.direction.noop', values: interpolation };
  return {
    key: newShares > oldShares ? 'split.direction.forward' : 'split.direction.reverse',
    values: interpolation,
  };
}

/** Form state → wire body. Only called after the schema has validated. */
export function toSplitRequest(
  values: SplitFormValues,
  flags: { changeTransactions: boolean; changeHistoricalQuotes: boolean },
): SplitRequestBody {
  return {
    securityId: values.securityId,
    exDate: values.exDate,
    newShares: toPositiveNumber(values.newShares) ?? 0,
    oldShares: toPositiveNumber(values.oldShares) ?? 0,
    changeTransactions: flags.changeTransactions,
    changeHistoricalQuotes: flags.changeHistoricalQuotes,
  };
}
