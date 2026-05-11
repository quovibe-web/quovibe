import { isApiError } from '@/api/query-client';
import {
  transactionFormBaseSchema,
  type TransactionFormShape,
} from './transaction-form.schema';

export interface ServerFieldError {
  field: keyof TransactionFormShape;
  message: string;
}

// Derived from the schema so a new form field is auto-tracked. `type` is a
// parent-controlled prop on TransactionForm with no `<FormMessage>` to render
// under, so an invalid-type code stays on the global toast instead.
const KNOWN_FORM_FIELDS: Set<keyof TransactionFormShape> = new Set(
  (Object.keys(transactionFormBaseSchema.shape) as (keyof TransactionFormShape)[])
    .filter((k) => k !== 'type'),
);

// Wire codes from `enforceCrossCurrencyFxRate` and similar route-layer guards
// that fire AFTER Zod parse — they emit `{error: CODE}` with no `details`
// array, so the field they pertain to is implicit. Keep this map narrow:
// only codes that map unambiguously to ONE form field belong here. Generic
// codes (DUPLICATE, NOT_FOUND, …) stay on the global toast.
const NON_FIELD_CODE_MAP: Record<string, keyof TransactionFormShape> = {
  FX_RATE_REQUIRED: 'fxRate',
};

/**
 * Translates a server validation error into a list of per-field errors that
 * `react-hook-form`'s `setError` can consume. The wire shape we expect is the
 * one emitted by `errorHandler` in the API: `{error:'Validation error',
 * details: ZodError.errors}`. `apiFetch` packs the rest of the body (minus
 * `error`) into `ApiError.details`, so the Zod issues end up at
 * `apiError.details.details`.
 *
 * Non-Zod 400s carry no `details` array; a small allowlist
 * (`NON_FIELD_CODE_MAP`) maps them to the single form field they pertain to.
 * Codes outside the allowlist resolve to `[]` so the global toast remains the
 * sole feedback channel for them.
 */
export function extractServerFieldErrors(err: unknown): ServerFieldError[] {
  if (!isApiError(err)) return [];

  const issues = (err.details as { details?: unknown } | undefined)?.details;
  if (Array.isArray(issues)) {
    const out: ServerFieldError[] = [];
    for (const issue of issues) {
      if (typeof issue !== 'object' || issue === null) continue;
      const path = (issue as { path?: unknown }).path;
      const message = (issue as { message?: unknown }).message;
      if (!Array.isArray(path) || path.length === 0) continue;
      if (typeof message !== 'string' || message.length === 0) continue;
      const head = path[0];
      if (typeof head !== 'string') continue;
      if (!KNOWN_FORM_FIELDS.has(head as keyof TransactionFormShape)) continue;
      out.push({ field: head as keyof TransactionFormShape, message });
    }
    return out;
  }

  if (NON_FIELD_CODE_MAP[err.code]) {
    return [{ field: NON_FIELD_CODE_MAP[err.code]!, message: err.code }];
  }

  return [];
}
