import { z } from 'zod';
import {
  AMOUNT_REQUIRED_TYPES,
  CROSS_CURRENCY_FX_TYPES,
  SECURITY_REQUIRED_TYPES,
  TransactionType,
} from '@quovibe/shared';

// Date / time stay in local component state (calendar popover + locale parsing
// is heavy enough that keeping it outside RHF avoids re-renders on every
// keystroke). They are merged into the wire payload at submit time, not
// surfaced through the form schema.
export const transactionFormBaseSchema = z.object({
  type: z.nativeEnum(TransactionType),
  securityId: z.string().optional(),
  accountId: z.string(),
  crossAccountId: z.string().optional(),
  shares: z.string().optional(),
  amount: z.string().optional(),
  price: z.string().optional(),
  fees: z.string().optional(),
  taxes: z.string().optional(),
  fxRate: z.string().optional(),
  feesFx: z.string().optional(),
  taxesFx: z.string().optional(),
  note: z.string().optional(),
});

export type TransactionFormShape = z.infer<typeof transactionFormBaseSchema>;

// Caller contract:
// - `isCrossCurrency` MUST be derived from the resolved currencies of the
//   selected account / cross-account / security. Hardcoding `false` skips
//   client-side cross-currency FX validation; the wire schema can't enforce it
//   (no DB access in @quovibe/shared), so `enforceCrossCurrencyFxRate` in the
//   route layer becomes the only remaining gate.
// - The `shows*` flags MUST mirror the FIELD_CONFIG entry for the active
//   transaction type — they tell the schema which fields the user can edit
//   so hidden fields are never required and never validated.
// Subset of FIELD_CONFIG that the schema needs. Structural typing means a
// caller can pass the full FIELD_CONFIG[type] entry directly.
export interface TransactionFieldVisibility {
  crossAccountId: boolean;
  amount: boolean;
  shares: boolean;
  price: boolean;
  fees: boolean;
  taxes: boolean;
}

export interface TransactionFormSchemaContext {
  type: TransactionType;
  isCrossCurrency: boolean;
  fields: TransactionFieldVisibility;
}

export type Translator = (key: string) => string;

function isPresent(v: string | undefined): v is string {
  return v != null && v.trim() !== '';
}

// Strict numeric grammar: optional sign, digits, optional fraction, optional
// exponent. Rejects ' 10 ' (silently trimmed by Number()), '1 0', '1,5'
// (locale comma), and other whitespace/punctuation that Number() would coerce
// or NaN inconsistently. Matches what the wire schema's z.number() accepts
// after preparePayload's parseFloat().
const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function parseFiniteNumber(v: string): number | null {
  if (!NUMERIC_RE.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildTransactionFormSchema(
  ctx: TransactionFormSchemaContext,
  t: Translator,
) {
  const { type, isCrossCurrency, fields } = ctx;
  const securityRequired = SECURITY_REQUIRED_TYPES.has(type);
  const amountMustBePositive = AMOUNT_REQUIRED_TYPES.has(type);
  const fxRequiredWhenCross = CROSS_CURRENCY_FX_TYPES.has(type);

  function issue(c: z.RefinementCtx, path: string, key: string) {
    c.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: t(key) });
  }

  function requirePositive(c: z.RefinementCtx, path: string, value: string | undefined, requiredKey: string, positiveKey: string) {
    if (!isPresent(value)) {
      issue(c, path, requiredKey);
      return;
    }
    const n = parseFiniteNumber(value);
    if (n == null || n <= 0) issue(c, path, positiveKey);
  }

  function allowOptionalNonNegative(c: z.RefinementCtx, path: string, value: string | undefined, key: string) {
    if (!isPresent(value)) return;
    const n = parseFiniteNumber(value);
    if (n == null || n < 0) issue(c, path, key);
  }

  return transactionFormBaseSchema.superRefine((data, c) => {
    if (securityRequired && !isPresent(data.securityId)) issue(c, 'securityId', 'validation.securityRequired');
    if (!isPresent(data.accountId)) issue(c, 'accountId', 'validation.accountRequired');
    if (fields.crossAccountId && !isPresent(data.crossAccountId)) issue(c, 'crossAccountId', 'validation.targetRequired');
    if (
      isPresent(data.accountId) &&
      isPresent(data.crossAccountId) &&
      data.accountId === data.crossAccountId
    ) {
      issue(c, 'crossAccountId', 'validation.sourceDestMustDiffer');
    }

    if (fields.shares) {
      requirePositive(c, 'shares', data.shares, 'validation.sharesRequired', 'validation.sharesMustBePositive');
    }

    if (fields.price) {
      // BUY/SELL derive amount = shares × price; both must be > 0 to satisfy
      // AMOUNT_REQUIRED_TYPES on the wire. SECURITY_TRANSFER + DELIVERY_*
      // accept amount = 0 (ppxml2db share-only convention), so price may be
      // empty or 0 for those types.
      if (amountMustBePositive) {
        requirePositive(c, 'price', data.price, 'validation.priceMustBePositive', 'validation.priceMustBePositive');
      } else {
        allowOptionalNonNegative(c, 'price', data.price, 'validation.priceMustBePositive');
      }
    }

    if (fields.amount && amountMustBePositive) {
      requirePositive(c, 'amount', data.amount, 'validation.amountRequired', 'validation.amountMustBePositive');
    }

    if (fields.fees) allowOptionalNonNegative(c, 'fees', data.fees, 'validation.feesMustBeNonNegative');
    if (fields.taxes) allowOptionalNonNegative(c, 'taxes', data.taxes, 'validation.taxesMustBeNonNegative');

    if (isCrossCurrency && fxRequiredWhenCross) {
      requirePositive(c, 'fxRate', data.fxRate, 'validation.fxRateMustBePositive', 'validation.fxRateMustBePositive');
      allowOptionalNonNegative(c, 'feesFx', data.feesFx, 'validation.feesMustBeNonNegative');
      allowOptionalNonNegative(c, 'taxesFx', data.taxesFx, 'validation.taxesMustBeNonNegative');
    }
  });
}
