import { z } from 'zod';
import { isRealCalendarDate, type ManualPriceInput } from '@quovibe/shared';
import { normalizeDecimalInput } from '@/lib/decimal-input';
import { isPresent } from '@/lib/utils';
import type { RawPriceRow } from '@/api/use-manual-prices';

// Form schema is all-strings so optional OHLCV fields can be '' (empty input)
// without failing the Save gate. The wire schema (manualPriceSchema) rejects ''
// for positiveDecimal and expects a number for volume, so binding it directly
// would permanently disable Save on any row with blank optionals. We convert to
// the wire shape (ManualPriceInput) on submit via toWirePayload.

export type Translator = (key: string) => string;

export type PriceFormValues = {
  date: string;
  value: string;
  open: string;
  high: string;
  low: string;
  volume: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Positive decimal grammar mirrors the wire schema's positiveDecimal: no leading
// zeros, optional fraction. Keeps GET->PUT round-trips byte-stable.
const DECIMAL_RE = /^(0|[1-9]\d*)(\.\d+)?$/;
const INTEGER_RE = /^\d+$/;

function isPositiveDecimal(s: string): boolean {
  const n = normalizeDecimalInput(s);
  return DECIMAL_RE.test(n) && parseFloat(n) > 0;
}

/**
 * Build the price-entry form schema. Every validation message is already
 * translated via `t(key)` because shadcn's FormMessage renders
 * `String(error.message)` with no t() — passing raw keys would surface code
 * strings to the user. Mirrors the canonical transaction-form.schema factory.
 */
export function buildPriceFormSchema(t: Translator) {
  return z.object({
    date: z
      .string()
      .regex(DATE_RE, t('priceHistory.form.errors.invalidDate'))
      .refine(isRealCalendarDate, t('priceHistory.form.errors.invalidDate')),
    value: z
      .string()
      .refine(isPositiveDecimal, t('priceHistory.form.errors.invalidValue')),
    open: z
      .string()
      .refine(
        (s) => !isPresent(s) || isPositiveDecimal(s),
        t('priceHistory.form.errors.invalidPrice'),
      ),
    high: z
      .string()
      .refine(
        (s) => !isPresent(s) || isPositiveDecimal(s),
        t('priceHistory.form.errors.invalidPrice'),
      ),
    low: z
      .string()
      .refine(
        (s) => !isPresent(s) || isPositiveDecimal(s),
        t('priceHistory.form.errors.invalidPrice'),
      ),
    volume: z
      .string()
      .refine(
        (s) => !isPresent(s) || INTEGER_RE.test(s),
        t('priceHistory.form.errors.invalidVolume'),
      ),
  });
}

/** Empty form values for the Add dialog. */
export const EMPTY_FORM: PriceFormValues = {
  date: '',
  value: '',
  open: '',
  high: '',
  low: '',
  volume: '',
};

/**
 * Convert form values to the wire payload. '' → undefined for optionals;
 * value/date pass through as strings; volume '' → undefined, else parseInt.
 */
export function toWirePayload(values: PriceFormValues): ManualPriceInput {
  // Price-shaped fields normalize the comma decimal to the dot form the wire
  // schema (positiveDecimal) expects. Volume stays raw — it is an integer count
  // with no decimal separator.
  const coerce = (s: string): string | undefined =>
    isPresent(s) ? normalizeDecimalInput(s) : undefined;
  const coerceVolume = (s: string): number | undefined =>
    isPresent(s) ? parseInt(s.trim(), 10) : undefined; // native-ok: integer parse
  return {
    date: values.date,
    value: normalizeDecimalInput(values.value),
    open: coerce(values.open),
    high: coerce(values.high),
    low: coerce(values.low),
    volume: coerceVolume(values.volume),
  };
}

/**
 * Build form values pre-populated from an existing row (for Edit). null → '',
 * volume number → String. Genuinely-present values stay non-empty strings so
 * they round-trip through toWirePayload unchanged — editPrice replaces the whole
 * row, so this is what prevents an edit from silently wiping existing OHLCV.
 */
export function rowToFormValues(row: RawPriceRow): PriceFormValues {
  return {
    date: row.date,
    value: row.value,
    open: row.open ?? '',
    high: row.high ?? '',
    low: row.low ?? '',
    volume: row.volume != null ? String(row.volume) : '',
  };
}
